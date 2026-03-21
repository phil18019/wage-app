// app/lib/userId.ts
export function getOrCreateUserId() {
  if (typeof window === "undefined") return null;

  let id = localStorage.getItem("pc_user_id");

  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("pc_user_id", id);
  }

  return id;
}