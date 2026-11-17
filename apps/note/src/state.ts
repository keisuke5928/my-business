// アプリの今の状態と、Firestore からの読み込み。
import { collection, doc, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { db } from "./fb";

export interface Consent { version: string; termsVersion: string; at: number; text: string; }
export interface UserDoc {
  createdAt: number; consent?: Consent; utm?: { source: string; medium: string; campaign: string }; device?: string;
  workplaceId?: string; dept?: string; places?: { id: string; dept: string; from: number }[]; linked?: boolean; lastAt?: number;
}
export interface Note {
  id: string; wid: string; dept: string; heading: string; title: string; text: string; steps: string[];
  photos: string[]; photoBytes: number; ai: boolean; aiEdited: boolean; tags: string[]; createdAt: number; updatedAt: number;
}
export interface Card { id: string; front: string; back: string; kind: string; heading: string; known: boolean | null; practiced: number; createdAt: number; }
export interface Place { id: string; name: string; area: string; norm: string; mergedInto: string; adopted: boolean; }

export const S = {
  uid: "", anonymous: true, loaded: false, user: null as UserDoc | null,
  notes: [] as Note[], cards: [] as Card[], place: null as Place | null,
  tab: "note" as "note" | "cards" | "pdf" | "me", changingPlace: false, aiOff: false,
};
let rerenderFn: () => void = () => {};
export const setRerender = (f: () => void): void => { rerenderFn = f; };
export const rerender = (): void => rerenderFn();

let subs: Unsubscribe[] = [], placeSub: Unsubscribe | null = null, placeId = "";
export function watchUser(uid: string): void {
  subs.forEach((u) => u()); subs = []; S.loaded = false; S.user = null; S.notes = []; S.cards = [];
  subs.push(onSnapshot(doc(db, "users", uid), (s) => { S.user = s.exists() ? (s.data() as UserDoc) : null; S.loaded = true; watchPlace(S.user?.workplaceId || ""); rerender(); }, () => { S.loaded = true; rerender(); }));
  subs.push(onSnapshot(collection(db, "users", uid, "notes"), (s) => { S.notes = s.docs.map((d) => ({ ...(d.data() as Omit<Note, "id">), id: d.id })).sort((a, b) => a.createdAt - b.createdAt); rerender(); }, () => {}));
  subs.push(onSnapshot(collection(db, "users", uid, "cards"), (s) => { S.cards = s.docs.map((d) => ({ ...(d.data() as Omit<Card, "id">), id: d.id })).sort((a, b) => a.createdAt - b.createdAt); rerender(); }, () => {}));
}
function watchPlace(id: string): void {
  if (id === placeId) return;
  placeId = id; if (placeSub) { placeSub(); placeSub = null; }
  S.place = null; if (!id) return;
  placeSub = onSnapshot(doc(db, "workplaces", id), (s) => { S.place = s.exists() ? ({ ...(s.data() as Omit<Place, "id">), id: s.id }) : null; rerender(); }, () => {});
}
// 今の職場と部署のメモ、カード
export const myNotes = (): Note[] => S.notes.filter((n) => n.wid === (S.user?.workplaceId || "") && n.dept === (S.user?.dept || ""));
