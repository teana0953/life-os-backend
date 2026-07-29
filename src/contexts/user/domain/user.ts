export interface User {
  id: string;
  firebaseUid: string;
  email: string;
  displayName: string | null;
  /** IANA zone used for all reminder time-of-day evaluation; defaults to "Asia/Taipei". */
  timezone: string;
  /** Authority for admin-only endpoints; false by default, granted out of band by direct data change. */
  isAdmin: boolean;
  createdAt: Date;
}
