export class CareBaseDecryptError extends Error {
  constructor(message = 'Failed to decrypt record.') {
    super(message);
    this.name = 'CareBaseDecryptError';
  }
}
