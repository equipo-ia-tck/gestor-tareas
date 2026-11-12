/** Error con código HTTP para responder a la app (lo usan el servidor y los conectores). */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
