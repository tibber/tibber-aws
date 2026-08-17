export type QueueSubjectListenerErrorContext = {
  cause?: unknown;
  subject?: string;
  messageId?: string;
  attempt?: number;
  maxAttempts?: number;
};

export class QueueSubjectListenerError extends Error {
  public readonly subject?: string;
  public readonly messageId?: string;
  public readonly attempt?: number;
  public readonly maxAttempts?: number;

  constructor(message: string, context: QueueSubjectListenerErrorContext = {}) {
    super(message, {cause: context.cause});
    this.name = 'QueueSubjectListenerError';
    this.subject = context.subject;
    this.messageId = context.messageId;
    this.attempt = context.attempt;
    this.maxAttempts = context.maxAttempts;
  }
}


export type QueueSubjectListenerErrorHandler = (
  error: QueueSubjectListenerError
) => void;
