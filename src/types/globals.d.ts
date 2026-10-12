/**
 * Global augmentation to silence the TypeScript error for the
 * cleanup-registration flag used in the WebAuthn challenge store.
 */
declare global {
  var __webauthnCleanupRegistered: boolean | undefined;
}

export {};
