const { v4: uuidv4 } = require("uuid");
const {
  connectMongo,
  mongoose,
} = require("../../src/infrastructure/mongo/mongo-client");
const {
  sequelize,
} = require("../../src/infrastructure/sequelize/sequelize-client");
const { UserModel } = require("../../src/modules/user/models/user.model");
const { ROLES } = require("../../src/shared/constants/roles");
const { hashText } = require("../../src/shared/tools/hash");
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query) =>
  new Promise((resolve) => rl.question(query, resolve));

function makeProfile(fullName) {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts.shift() || "Super";
  const lastName = parts.join(" ") || "Admin";
  return { firstName, lastName };
}

async function createOrUpdateMongoUser({
  email,
  phone,
  fullName,
  passwordHash,
}) {
  const existingUser = await UserModel.findOne({ email });
  const payload = {
    email,
    phone,
    passwordHash,
    role: ROLES.SUPER_ADMIN,
    accountStatus: "active",
    emailVerified: true,
    profile: makeProfile(fullName),
    authProviders: [],
  };

  if (existingUser) {
    existingUser.set(payload);
    await existingUser.save();
    return { user: existingUser, created: false };
  }

  const user = await UserModel.create({
    ...payload,
    refreshSessions: [],
  });

  return { user, created: true };
}

async function createSuperAdmin() {
  let createdMongoUserId = null;
  let transaction = null;

  try {
    await connectMongo();
    await sequelize.authenticate();
    console.log("✓ Databases connected");

    // Check if super admin already exists
    const [existingSuperAdmins] = await sequelize.query(
      `SELECT * FROM super_admins LIMIT 1`,
    );

    if (existingSuperAdmins.length > 0) {
      console.log("\n⚠️  Existing super admin record(s) found — removing old entries and updating with new values\n");

      // Attempt to remove previous super admin markers and role assignments
      try {
        // Remove super_admins entries
        await sequelize.query(`DELETE FROM super_admins`);

        // If a super-admin role exists, remove any user_roles assignments for that role
        const [superAdminRoles] = await sequelize.query(
          `SELECT id FROM roles WHERE is_super_admin = true LIMIT 1`,
        );
        if (superAdminRoles && superAdminRoles.length) {
          const roleIdToRemove = superAdminRoles[0].id;
          await sequelize.query(`DELETE FROM user_roles WHERE role_id = :roleId`, {
            replacements: { roleId: roleIdToRemove },
          });
        }

        console.log("✓ Previous super admin markers and role assignments removed");
      } catch (err) {
        console.warn("⚠️  Failed to fully remove previous super admin DB markers:", err.message);
        // proceed — create/update will still attempt to set correct state
      }
    }

    console.log("\n🔐 Super Admin Creation - One Time Setup\n");

    // Get user input
    const email = await question("Enter Email: ");
    const fullName = await question("Enter Full Name: ");
    const phone = await question("Enter Phone (optional): ");
    const password = await question("Enter Password: ");

    if (!email || !fullName || !password) {
      console.error("\n❌ All fields are required!\n");
      process.exitCode = 1;
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.error("\n❌ Invalid email format!\n");
      process.exitCode = 1;
      return;
    }

    // Hash password
    const passwordHash = await hashText(password);
    const { user, created } = await createOrUpdateMongoUser({
      email,
      phone: phone || undefined,
      fullName,
      passwordHash,
    });
    const userId = String(user.id);
    createdMongoUserId = created ? userId : null;
    console.log(
      created ? "✓ Mongo auth user created" : "✓ Mongo auth user updated",
    );

    // Start transaction
    transaction = await sequelize.transaction();

    try {
      const superAdminId = uuidv4();
      const superAdminRoleId = uuidv4();

      // 1. Check if super admin role exists in roles table
      const [superAdminRoles] = await sequelize.query(
        `SELECT id FROM roles WHERE is_super_admin = true LIMIT 1`,
        { transaction, raw: true },
      );

      let roleId;
      if (!superAdminRoles || superAdminRoles.length === 0) {
        // Create super admin role
        roleId = superAdminRoleId;
        await sequelize.query(
          `
          INSERT INTO roles (id, name, slug, description, type, is_super_admin, active, created_at, updated_at)
          VALUES (:id, :name, :slug, :description, :type, :isSuperAdmin, :active, NOW(), NOW())
          `,
          {
            replacements: {
              id: roleId,
              name: "Super Admin",
              slug: "super-admin",
              description: "Super Admin role with all permissions",
              type: "system",
              isSuperAdmin: true,
              active: true,
            },
            transaction,
          },
        );
        console.log("✓ Super admin role created");
      } else {
        roleId = superAdminRoles[0].id;
      }

      // 2. Create super admin marker for the Mongo auth user
      await sequelize.query(
        `
        INSERT INTO super_admins (id, user_id, email, full_name, is_active, created_at, updated_at)
        VALUES (:id, :userId, :email, :fullName, :isActive, NOW(), NOW())
        `,
        {
          replacements: {
            id: superAdminId,
            userId,
            email,
            fullName,
            isActive: true,
          },
          transaction,
        },
      );
      console.log("✓ Super admin marker created");

      // 3. Assign super admin role to user
      await sequelize.query(
        `
        INSERT INTO user_roles (id, user_id, role_id, assigned_at)
        VALUES (:id, :userId, :roleId, NOW())
        `,
        {
          replacements: { id: uuidv4(), userId, roleId },
          transaction,
        },
      );
      console.log("✓ Super admin role assigned to user");

      // Commit transaction
      await transaction.commit();
      transaction = null;

      console.log("\n✅ Super Admin created successfully!\n");
      console.log("Details:");
      console.log(`  User ID: ${userId}`);
      console.log(`  Email: ${email}`);
      console.log(`  Full Name: ${fullName}`);
      console.log(`  Role: Super Admin\n`);
      console.log(
        "Login with POST /api/v1/auth/login using this email and password.\n",
      );

      return;
    } catch (error) {
      if (transaction) {
        await transaction.rollback();
        transaction = null;
      }
      if (createdMongoUserId) {
        await UserModel.findByIdAndDelete(createdMongoUserId);
      }
      throw error;
    }
  } catch (error) {
    console.error("\n❌ Error creating super admin:", error.message);
    console.error(error);
    process.exitCode = 1;
  } finally {
    rl.close();
    await sequelize.close();
    await mongoose.disconnect();
  }
}

// Run the script
createSuperAdmin();
