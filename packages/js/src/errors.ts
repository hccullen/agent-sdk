/**
 * Re-exports of the underlying `@corti/sdk` error classes, exposed for
 * convenience so consumers don't need to import `@corti/sdk` directly.
 * Since these are the same classes (not wrappers), `instanceof` checks work
 * identically against either import.
 */
export {
  CortiError,
  CortiSDKError,
  CortiSDKErrorCodes,
  CortiTimeoutError,
} from "@corti/sdk";
