#include "ubx.h"

#include <string.h>

namespace ubx {

namespace {
enum : uint8_t { S_SYNC1, S_SYNC2, S_CLS, S_ID, S_LEN1, S_LEN2, S_PAYLOAD, S_CKA, S_CKB };

inline uint16_t u2(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }
inline uint32_t u4(const uint8_t *p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }
inline int32_t i4(const uint8_t *p) { return (int32_t)u4(p); }

// Copia un texto de ancho fijo del receptor (puede no acabar en cero), solo con caracteres imprimibles
// y sin comillas ni barras, para poder meterlo tal cual en el JSON del informe
void copyText(char *dst, size_t cap, const uint8_t *src, size_t n) {
  size_t j = 0;
  for (size_t i = 0; i < n && src[i] && j + 1 < cap; i++) {
    char c = (char)src[i];
    if (c < 0x20 || c > 0x7E || c == '"' || c == '\\') continue;
    dst[j++] = c;
  }
  dst[j] = 0;
}
}  // namespace

bool Parser::feed(uint8_t b) {
  switch (state_) {
    case S_SYNC1:
      if (b == SYNC1) state_ = S_SYNC2;
      return false;
    case S_SYNC2:
      // Otro 0xB5 seguido puede ser el principio de la trama buena
      state_ = b == SYNC2 ? S_CLS : (b == SYNC1 ? S_SYNC2 : S_SYNC1);
      return false;
    case S_CLS:
      cls_ = b;
      ckA_ = b;
      ckB_ = ckA_;
      state_ = S_ID;
      return false;
    case S_ID:
      id_ = b;
      ckA_ += b;
      ckB_ += ckA_;
      state_ = S_LEN1;
      return false;
    case S_LEN1:
      len_ = b;
      ckA_ += b;
      ckB_ += ckA_;
      state_ = S_LEN2;
      return false;
    case S_LEN2:
      len_ |= (uint16_t)b << 8;
      ckA_ += b;
      ckB_ += ckA_;
      if (len_ > MAX) {
        long_++;
        state_ = S_SYNC1;
        return false;
      }
      pos_ = 0;
      state_ = len_ ? S_PAYLOAD : S_CKA;
      return false;
    case S_PAYLOAD:
      buf_[pos_++] = b;
      ckA_ += b;
      ckB_ += ckA_;
      if (pos_ >= len_) state_ = S_CKA;
      return false;
    case S_CKA:
      if (b != ckA_) {
        bad_++;
        state_ = b == SYNC1 ? S_SYNC2 : S_SYNC1;
        return false;
      }
      state_ = S_CKB;
      return false;
    case S_CKB:
      state_ = S_SYNC1;
      if (b != ckB_) {
        bad_++;
        if (b == SYNC1) state_ = S_SYNC2;
        return false;
      }
      frame_.cls = cls_;
      frame_.id = id_;
      frame_.len = len_;
      frame_.payload = buf_;
      return true;
  }
  state_ = S_SYNC1;
  return false;
}

size_t build(uint8_t cls, uint8_t id, const uint8_t *payload, uint16_t len, uint8_t *out, size_t cap) {
  const size_t n = (size_t)len + 8;
  if (n > cap) return 0;
  out[0] = SYNC1;
  out[1] = SYNC2;
  out[2] = cls;
  out[3] = id;
  out[4] = (uint8_t)(len & 0xFF);
  out[5] = (uint8_t)(len >> 8);
  if (len) memcpy(out + 6, payload, len);
  uint8_t a = 0, b = 0;
  for (size_t i = 2; i < 6 + (size_t)len; i++) {
    a += out[i];
    b += a;
  }
  out[6 + len] = a;
  out[7 + len] = b;
  return n;
}

size_t buildValset1(const uint32_t *keys, const uint8_t *values, size_t n, uint8_t *out, size_t cap) {
  uint8_t p[4 + 5 * 16];
  if (n > 16) return 0;
  p[0] = 0;     // versión del mensaje
  p[1] = 0x01;  // capa: RAM
  p[2] = 0;
  p[3] = 0;
  size_t k = 4;
  for (size_t i = 0; i < n; i++) {
    p[k++] = (uint8_t)(keys[i] & 0xFF);
    p[k++] = (uint8_t)((keys[i] >> 8) & 0xFF);
    p[k++] = (uint8_t)((keys[i] >> 16) & 0xFF);
    p[k++] = (uint8_t)((keys[i] >> 24) & 0xFF);
    p[k++] = values[i];
  }
  return build(CLS_CFG, ID_CFG_VALSET, p, (uint16_t)k, out, cap);
}

bool parsePvt(const Frame &f, Pvt &o) {
  if (f.cls != CLS_NAV || f.id != ID_NAV_PVT || f.len < 92) return false;
  const uint8_t *p = f.payload;
  o.iTOW = u4(p + 0);
  o.year = u2(p + 4);
  o.month = p[6];
  o.day = p[7];
  o.hour = p[8];
  o.min = p[9];
  o.sec = p[10];
  o.valid = p[11];
  o.tAcc = u4(p + 12);
  o.nano = i4(p + 16);
  o.fixType = p[20];
  o.flags = p[21];
  o.numSV = p[23];
  o.lon = i4(p + 24);
  o.lat = i4(p + 28);
  o.height = i4(p + 32);
  o.hMSL = i4(p + 36);
  o.hAcc = u4(p + 40);
  o.vAcc = u4(p + 44);
  o.velN = i4(p + 48);
  o.velE = i4(p + 52);
  o.velD = i4(p + 56);
  o.gSpeed = i4(p + 60);
  o.headMot = i4(p + 64);
  o.sAcc = u4(p + 68);
  o.headAcc = u4(p + 72);
  o.pDOP = u2(p + 76);
  return true;
}

bool parseVersion(const Frame &f, Version &o) {
  if (f.cls != CLS_MON || f.id != ID_MON_VER || f.len < 40) return false;
  const uint8_t *p = f.payload;
  copyText(o.sw, sizeof o.sw, p, 30);
  copyText(o.hw, sizeof o.hw, p + 30, 10);
  o.mod[0] = 0;
  o.fw[0] = 0;
  for (size_t at = 40; at + 30 <= f.len; at += 30) {
    char ext[31];
    copyText(ext, sizeof ext, p + at, 30);
    if (!strncmp(ext, "MOD=", 4)) {
      strncpy(o.mod, ext + 4, sizeof o.mod - 1);
      o.mod[sizeof o.mod - 1] = 0;
    } else if (!strncmp(ext, "FWVER=", 6)) {
      strncpy(o.fw, ext + 6, sizeof o.fw - 1);
      o.fw[sizeof o.fw - 1] = 0;
    }
  }
  return true;
}

}  // namespace ubx
