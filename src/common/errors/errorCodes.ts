/** Every error code the API can return. Keep in sync with docs/api-documentation.md section 0.3. */
export const ERROR_CODES = {
  VALIDATION_ERROR: { status: 400, message: 'The request is invalid.' },
  INVALID_OTP: { status: 400, message: 'The code is incorrect or has expired.' },
  INVALID_UPLOAD: { status: 400, message: 'The uploaded image is not acceptable.' },
  INVALID_PAYMENT_ACCOUNT: { status: 400, message: 'This payment account is not available.' },
  QR_INVALID: { status: 400, message: 'This is not a valid mess QR code.' },

  UNAUTHORIZED: { status: 401, message: 'Please sign in to continue.' },
  TOKEN_EXPIRED: { status: 401, message: 'Your session has expired.' },
  INVALID_CREDENTIALS: { status: 401, message: 'Incorrect email or password.' },

  FORBIDDEN: { status: 403, message: 'You are not allowed to do this.' },
  EMAIL_NOT_VERIFIED: { status: 403, message: 'Please verify your email first.' },
  ACCOUNT_DISABLED: { status: 403, message: 'Your account is disabled. Contact the mess admin.' },
  WRONG_MESS: { status: 403, message: 'This QR code belongs to a different mess.' },

  NOT_FOUND: { status: 404, message: 'Not found.' },

  EMAIL_ALREADY_REGISTERED: { status: 409, message: 'This email is already registered.' },
  PENDING_PAYMENT_EXISTS: { status: 409, message: 'You already have a payment waiting for review.' },
  DUPLICATE_TRANSACTION: { status: 409, message: 'This transaction ID has already been used.' },
  PAYMENT_NOT_PENDING: { status: 409, message: 'This payment has already been reviewed.' },
  ALREADY_MARKED: { status: 409, message: 'Attendance is already marked for this meal today.' },
  QR_LABEL_EXISTS: { status: 409, message: 'An active QR code with this label already exists.' },
  QR_ALREADY_REVOKED: { status: 409, message: 'This QR code is already revoked.' },
  SUBSCRIPTION_NOT_CANCELLABLE: { status: 409, message: 'This subscription cannot be cancelled.' },
  SUBSCRIPTION_OVERLAP: { status: 409, message: 'Subscription periods overlap.' },
  LAST_SUPER_ADMIN: { status: 409, message: 'The last active super admin cannot be changed.' },
  CONFLICT: { status: 409, message: 'The request conflicts with the current state.' },

  QR_REVOKED: { status: 422, message: 'This QR code is no longer valid.' },
  OUTSIDE_MEAL_WINDOW: { status: 422, message: 'Attendance is not open right now.' },
  LOCATION_REQUIRED: { status: 422, message: 'Your location is needed to confirm you are at the mess.' },
  OUTSIDE_MESS_AREA: { status: 422, message: 'You appear to be away from the mess.' },
  NO_ACTIVE_SUBSCRIPTION: { status: 422, message: 'You need an active subscription.' },

  RATE_LIMITED: { status: 429, message: 'Too many requests. Please wait a moment.' },

  INTERNAL_ERROR: { status: 500, message: 'Something went wrong. Please try again.' },
  SERVICE_UNAVAILABLE: { status: 503, message: 'Service temporarily unavailable.' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
