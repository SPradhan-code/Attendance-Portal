/**
 * Global augmentation to silence the TypeScript error for the
 * cleanup-registration flag used in the WebAuthn challenge store.
 */
declare global {
  // eslint-disable-next-line no-var
  var __webauthnCleanupRegistered: boolean | undefined;
}

export {};
