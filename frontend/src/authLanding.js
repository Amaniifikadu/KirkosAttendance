export function getLoginRequest(accountType, identity, password) {
  if (!["admin", "teacher", "student"].includes(accountType)) {
    throw new Error("Choose a valid account type.");
  }
  if (accountType === "admin") {
    return {
      path: "/api/auth/admin/login",
      body: { email: identity, password },
    };
  }
  return {
    path: "/api/auth/portal/login",
    body: { username: identity, password, expectedRole: accountType },
  };
}

export function getRegistrationGuidance(accountType) {
  switch (accountType) {
    case "admin":
      return {
        heading: "Administrator accounts are securely provisioned",
        message:
          "There is no public administrator sign-up. The initial administrator is created with the one-time backend bootstrap command. Any further administrator access must be arranged through the system operator using a secure process.",
      };
    case "teacher":
      return {
        heading: "Ask an administrator to create your teacher account",
        message:
          "Administrators create teacher accounts and assign the classes and subjects you are authorized to access. They will provide your username and temporary password.",
      };
    case "student":
      return {
        heading: "Ask an administrator to create your student account",
        message:
          "Student accounts are linked to an existing student record and student number. An administrator will provide your username and temporary password; you will change it at first sign-in.",
      };
    default:
      throw new Error("Choose a valid account type.");
  }
}
