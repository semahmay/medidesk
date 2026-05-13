let _googleId = null;

export function setUserId(googleId) {
  _googleId = googleId || null;
}

export function clearUserId() {
  _googleId = null;
}

export function getUserId() {
  return _googleId;
}
