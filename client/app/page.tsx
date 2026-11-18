import { redirect } from "next/navigation";

// This route only redirects, so opt it out of instant-navigation validation.
export const instant = false;

export default function Home() {
  redirect("/chat");
}
