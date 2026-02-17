declare module 'kuromoji' {
  interface KuromojiToken {
    surface_form: string;
    reading?: string;
    pos: string;
    basic_form: string;
    word_type: string;
    pronunciation?: string;
  }

  interface Tokenizer {
    tokenize(text: string): KuromojiToken[];
  }

  interface BuilderOptions {
    dicPath: string;
  }

  interface Builder {
    build(callback: (err: Error | null, tokenizer: Tokenizer) => void): void;
  }

  function builder(options: BuilderOptions): Builder;
}
