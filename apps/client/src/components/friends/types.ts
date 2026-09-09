export type FriendStatus = "accepted" | "pending_incoming" | "pending_outgoing";
export type FilterTab = "all" | "friends" | "pending";

export interface Friend {
  id: string;
  name: string;
  email: string;
  status: FriendStatus;
}

export const TABS: { key: FilterTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "friends", label: "Friends" },
  { key: "pending", label: "Pending" },
];
