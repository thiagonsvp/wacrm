declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string
  }

  function pdfParse(data: Buffer): Promise<PdfParseResult>
  export default pdfParse
}
