import Link from "next/link";

export default function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Chatter home">
      <span className="brand-mark" aria-hidden="true">
        C
      </span>
      <span className="brand-name">Chatter</span>
    </Link>
  );
}
