declare module 'mailparser' {
  export interface ParsedAddress {
    address?: string;
    name?: string;
  }
  export interface ParsedMailAttachment {
    filename?: string;
    contentType?: string;
    content: Buffer;
  }
  export interface ParsedMail {
    subject?: string;
    text?: string;
    html?: string | false;
    date?: Date;
    from?: { value?: ParsedAddress[] };
    attachments?: ParsedMailAttachment[];
  }
  export function simpleParser(source: Buffer | string | NodeJS.ReadableStream): Promise<ParsedMail>;
}
