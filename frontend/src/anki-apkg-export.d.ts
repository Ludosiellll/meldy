declare module 'anki-apkg-export' {
  export default class ApkgExport {
    constructor(deckName: string);
    addCard(front: string, back: string): void;
    save(): Promise<Blob>;
  }
}
