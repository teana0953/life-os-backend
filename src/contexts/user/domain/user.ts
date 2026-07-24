export interface User {
  id: string;
  firebaseUid: string;
  email: string;
  displayName: string | null;
  /** IANA zone used for all reminder time-of-day evaluation; defaults to "Asia/Taipei". */
  timezone: string;
  createdAt: Date;
}
