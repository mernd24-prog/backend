const { UserModel } = require("../models/user.model");

const escapeRegExp = (value) =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizePhoneIdentifier = (phone = "") => {
  let digits = String(phone || "").replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  }

  if (/^[6-9]\d{9}$/.test(digits)) {
    return `+91${digits}`;
  }

  return digits || undefined;
};

class UserRepository {
  async create(payload) {
    const phoneNormalized =
      payload.phoneNormalized ||
      normalizePhoneIdentifier(payload.phone);

    return UserModel.create({
      ...payload,
      ...(phoneNormalized ? { phoneNormalized } : {}),
    });
  }

  async findByEmail(email) {
    if (!email) {
      return null;
    }

    const normalizedEmail = String(email || "").trim();
    return UserModel.findOne({
      email: {
        $regex: new RegExp(`^${escapeRegExp(normalizedEmail)}$`, "i"),
      },
    });
  }
  async findUserByPhone(phone) {
    const normalized =
      String(phone || "").trim();

    const phoneIdentifier =
      normalizePhoneIdentifier(normalized);

    const digits =
      normalized.replace(/\D/g, "");

    const localPhone =
      digits.startsWith("91") &&
        digits.length === 12
        ? digits.slice(2)
        : digits;

    return UserModel.findOne({
      $or: [
        ...(phoneIdentifier
          ? [
            {
              phoneNormalized: phoneIdentifier,
            },
            {
              authProviders: {
                $elemMatch: {
                  provider: "mobile_otp",
                  providerUserId: phoneIdentifier,
                },
              },
            },
          ]
          : []),
        {
          phoneNormalized: normalized,
        },
        {
          phone: normalized,
        },
        {
          phone: localPhone,
        },
        {
          phone: `91${localPhone}`,
        },
        {
          phone: `+91${localPhone}`,
        },
        {
          "authProviders.provider": "mobile_otp",
          "authProviders.providerUserId":
            normalized,
        },
      ],
    });
  }

  async markOtpIdentityVerified(
    userId,
    {
      channel,
      email,
      mobile,
    },
  ) {
    const provider =
      channel === "email"
        ? "email_otp"
        : "mobile_otp";

    const providerUserId =
      channel === "email"
        ? email
        : mobile;

    const update = {
      $addToSet: {
        authProviders: {
          provider,
          providerUserId,
        },
      },
    };

    if (channel === "email") {
      update.$set = {
        email,
        emailVerified: true,
      };
    }

    if (channel === "mobile") {
      update.$set = {
        phone: mobile,
        phoneNormalized: mobile,
        phoneVerified: true,
      };
    }

    return UserModel.findByIdAndUpdate(
      userId,
      update,
      {
        new: true,
      },
    );
  }
  async findById(userId) {
    return UserModel.findById(userId).select("-passwordHash -refreshSessions.tokenHash");
  }

  async findByProvider(provider, providerUserId) {
    return UserModel.findOne({
      authProviders: {
        $elemMatch: {
          provider,
          providerUserId,
        },
      },
    });
  }

  async findByReferralCode(referralCode) {
    return UserModel.findOne({ referralCode });
  }

  async updateById(userId, payload) {
    return UserModel.findByIdAndUpdate(userId, payload, { new: true });
  }

  async updateOne(filter, payload) {
    return UserModel.findOneAndUpdate(filter, payload, { new: true });
  }
}

module.exports = { UserRepository };
