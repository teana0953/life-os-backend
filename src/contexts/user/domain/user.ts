export interface User {
  id: string;
  firebaseUid: string;
  email: string;
  displayName: string | null;
  createdAt: Date;
}
