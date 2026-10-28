const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createAdminAccount(request, token, email, password) {
  return request("/api/auth/admin/accounts", token, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function validateAdminAccountForm({ email, password, confirmPassword }) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return { error: "Email is required." };
  }
  if (normalizedEmail.length > 254 || !EMAIL_PATTERN.test(normalizedEmail)) {
    return { error: "Enter a valid email address of at most 254 characters." };
  }
  if (!password) {
    return { error: "Password is required." };
  }
  if (password.length < 12) {
    return { error: "Password must be at least 12 characters." };
  }
  if (new TextEncoder().encode(password).length > 72) {
    return { error: "Password must be no more than 72 UTF-8 bytes." };
  }
  if (!confirmPassword) {
    return { error: "Confirm the password." };
  }
  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }
  return { email: normalizedEmail };
}
