import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { users } from "./schema";

const MOCK_PASSWORD = "password123";

const mockUsers = [
  { name: "Alice Johnson", email: "alice@example.com" },
  { name: "Bob Smith", email: "bob@example.com" },
  { name: "Charlie Brown", email: "charlie@example.com" },
  { name: "Diana Prince", email: "diana@example.com" },
  { name: "Ethan Hunt", email: "ethan@example.com" },
];

async function seed() {
  const hashedPassword = await bcrypt.hash(MOCK_PASSWORD, 10);

  for (const mockUser of mockUsers) {
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, mockUser.email),
      columns: { id: true },
    });

    if (existingUser) {
      console.log(`Skipped ${mockUser.email} (already exists)`);
      continue;
    }

    await db.insert(users).values({
      name: mockUser.name,
      email: mockUser.email,
      password: hashedPassword,
    });

    console.log(`Created ${mockUser.name} <${mockUser.email}>`);
  }

  console.log(`\nAll mock users use the password: ${MOCK_PASSWORD}`);
  console.log("You can log in with any of these emails:");
  for (const mockUser of mockUsers) {
    console.log(`  ${mockUser.email} / ${MOCK_PASSWORD}`);
  }
}

seed()
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
