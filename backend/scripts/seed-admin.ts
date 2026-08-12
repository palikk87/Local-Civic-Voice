/**
 * Seeds (or repairs) the super admin as a real account in the shared database
 * so it logs in through the unified username/email flow like any other user.
 *
 * Username: palikk87   Password: CivicAdmin2024!
 */
import { auth } from "../src/auth";
import { prisma } from "../src/prisma";

const ADMIN_EMAIL = "palikk87@civicvoice.app";
const ADMIN_USERNAME = "palikk87";
const ADMIN_PASSWORD = "CivicAdmin2024!";
const ADMIN_NAME = "PaliKK87";

async function main() {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: ADMIN_EMAIL }, { username: ADMIN_USERNAME }] },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { role: "superadmin", username: ADMIN_USERNAME, name: ADMIN_NAME },
    });
    console.log(`Super admin already existed — ensured role/username. id=${existing.id}`);
    return;
  }

  // Create through Better Auth so the password is hashed and an Account row is made.
  await auth.api.signUpEmail({
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: ADMIN_NAME },
  });

  const user = await prisma.user.update({
    where: { email: ADMIN_EMAIL },
    data: { role: "superadmin", username: ADMIN_USERNAME },
  });

  console.log(`Created super admin. id=${user.id} username=${user.username} role=${user.role}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
