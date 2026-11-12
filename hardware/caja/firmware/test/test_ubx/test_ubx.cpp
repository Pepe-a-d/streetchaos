// Pruebas del lector de UBX (lib/ubx), en el ordenador: pio test -e native
#include <string.h>
#include <unity.h>

#include "ubx.h"

void setUp() {}
void tearDown() {}

namespace {

// Una NAV-PVT de 92 bytes con valores conocidos
size_t pvtFrame(uint8_t *out, size_t cap) {
  uint8_t p[92] = {0};
  auto w2 = [&](int at, uint16_t v) { p[at] = v & 0xFF; p[at + 1] = v >> 8; };
  auto w4 = [&](int at, uint32_t v) { for (int i = 0; i < 4; i++) p[at + i] = (v >> (8 * i)) & 0xFF; };
  w4(0, 123456000);
  w2(4, 2026);
  p[6] = 11;
  p[7] = 12;
  p[8] = 18;
  p[9] = 30;
  p[10] = 5;
  p[11] = 0x07;
  p[20] = 3;     // 3D
  p[21] = 0x01;  // gnssFixOK
  p[23] = 14;
  w4(24, (uint32_t)(int32_t)-12345678);
  w4(28, (uint32_t)(int32_t)123456789);
  w4(40, 1800);  // hAcc 1,8 m
  w4(60, 27778); // 100 km/h
  w4(64, (uint32_t)(int32_t)9000000);
  w2(76, 120);
  return ubx::build(ubx::CLS_NAV, ubx::ID_NAV_PVT, p, sizeof p, out, cap);
}

size_t verFrame(uint8_t *out, size_t cap) {
  uint8_t p[40 + 30 * 4] = {0};
  memcpy(p, "ROM SPG 4.04 (7f89f7)", 21);
  memcpy(p + 30, "000A0000", 8);
  memcpy(p + 40, "ROM BASE 0x118B2060", 19);
  memcpy(p + 70, "FWVER=SPG 4.04", 14);
  memcpy(p + 100, "PROTVER=32.01", 13);
  memcpy(p + 130, "MOD=NEO-M9N", 11);
  return ubx::build(ubx::CLS_MON, ubx::ID_MON_VER, p, sizeof p, out, cap);
}

int feedAll(ubx::Parser &ps, const uint8_t *b, size_t n, ubx::Pvt *pvt = nullptr, ubx::Version *ver = nullptr) {
  int frames = 0;
  for (size_t i = 0; i < n; i++)
    if (ps.feed(b[i])) {
      frames++;
      if (pvt) ubx::parsePvt(ps.frame(), *pvt);
      if (ver) ubx::parseVersion(ps.frame(), *ver);
    }
  return frames;
}

}  // namespace

void test_build_checksum() {
  // Petición de MON-VER: B5 62 0A 04 00 00 0E 34 (del manual de u-blox)
  uint8_t f[8];
  TEST_ASSERT_EQUAL_UINT32(8, ubx::build(ubx::CLS_MON, ubx::ID_MON_VER, nullptr, 0, f, sizeof f));
  const uint8_t want[8] = {0xB5, 0x62, 0x0A, 0x04, 0x00, 0x00, 0x0E, 0x34};
  TEST_ASSERT_EQUAL_UINT8_ARRAY(want, f, 8);
  TEST_ASSERT_EQUAL_UINT32(0, ubx::build(ubx::CLS_MON, ubx::ID_MON_VER, nullptr, 0, f, 7));
}

void test_pvt_among_nmea() {
  uint8_t buf[300];
  const char *nmea = "$GNGGA,183005.00,,,,,0,00,99.99,,,,,,*7A\r\n";
  size_t n = strlen(nmea);
  memcpy(buf, nmea, n);
  n += pvtFrame(buf + n, sizeof buf - n);
  memcpy(buf + n, nmea, strlen(nmea));
  n += strlen(nmea);
  ubx::Parser ps;
  ubx::Pvt p;
  TEST_ASSERT_EQUAL_INT(1, feedAll(ps, buf, n, &p));
  TEST_ASSERT_EQUAL_UINT16(2026, p.year);
  TEST_ASSERT_EQUAL_UINT8(11, p.month);
  TEST_ASSERT_EQUAL_UINT8(3, p.fixType);
  TEST_ASSERT_TRUE(p.fixOk());
  TEST_ASSERT_EQUAL_UINT8(14, p.numSV);
  TEST_ASSERT_EQUAL_INT32(-12345678, p.lon);
  TEST_ASSERT_EQUAL_INT32(123456789, p.lat);
  TEST_ASSERT_EQUAL_UINT32(1800, p.hAcc);
  TEST_ASSERT_EQUAL_INT32(27778, p.gSpeed);
  TEST_ASSERT_EQUAL_INT32(9000000, p.headMot);
  TEST_ASSERT_EQUAL_UINT16(120, p.pDOP);
  TEST_ASSERT_EQUAL_UINT32(0, ps.badChecksums());
}

void test_bad_checksum_then_good() {
  uint8_t a[120], b[120];
  const size_t na = pvtFrame(a, sizeof a);
  const size_t nb = pvtFrame(b, sizeof b);
  a[50] ^= 0x10;  // un bit cambiado en la carga
  ubx::Parser ps;
  TEST_ASSERT_EQUAL_INT(0, feedAll(ps, a, na));
  TEST_ASSERT_EQUAL_UINT32(1, ps.badChecksums());
  TEST_ASSERT_EQUAL_INT(1, feedAll(ps, b, nb));
}

void test_split_and_double_sync() {
  uint8_t f[120];
  const size_t n = pvtFrame(f, sizeof f);
  ubx::Parser ps;
  // Un 0xB5 suelto justo antes de la trama no debe hacer perderla
  TEST_ASSERT_FALSE(ps.feed(0xB5));
  int frames = 0;
  for (size_t i = 0; i < n; i++) frames += ps.feed(f[i]) ? 1 : 0;
  TEST_ASSERT_EQUAL_INT(1, frames);
}

void test_too_long_is_skipped() {
  const uint8_t big[6] = {0xB5, 0x62, 0x01, 0x07, 0xFF, 0x7F};  // 32767 bytes: no cabe
  uint8_t f[120];
  const size_t n = pvtFrame(f, sizeof f);
  ubx::Parser ps;
  TEST_ASSERT_EQUAL_INT(0, feedAll(ps, big, sizeof big));
  TEST_ASSERT_EQUAL_UINT32(1, ps.tooLong());
  TEST_ASSERT_EQUAL_INT(1, feedAll(ps, f, n));
}

void test_version() {
  uint8_t f[200];
  const size_t n = verFrame(f, sizeof f);
  ubx::Parser ps;
  ubx::Version v;
  TEST_ASSERT_EQUAL_INT(1, feedAll(ps, f, n, nullptr, &v));
  TEST_ASSERT_EQUAL_STRING("NEO-M9N", v.mod);
  TEST_ASSERT_EQUAL_STRING("SPG 4.04", v.fw);
  TEST_ASSERT_EQUAL_STRING("000A0000", v.hw);
  TEST_ASSERT_EQUAL_STRING("ROM SPG 4.04 (7f89f7)", v.sw);
}

void test_valset() {
  const uint32_t keys[2] = {ubx::KEY_I2COUTPROT_NMEA, ubx::KEY_MSGOUT_NAV_PVT_I2C};
  const uint8_t vals[2] = {0, 1};
  uint8_t f[32];
  const size_t n = ubx::buildValset1(keys, vals, 2, f, sizeof f);
  TEST_ASSERT_EQUAL_UINT32(8 + 4 + 10, n);
  TEST_ASSERT_EQUAL_UINT8(0x06, f[2]);
  TEST_ASSERT_EQUAL_UINT8(0x8A, f[3]);
  TEST_ASSERT_EQUAL_UINT8(0x01, f[7]);  // capa RAM
  const uint8_t k1[5] = {0x02, 0x00, 0x72, 0x10, 0x00};
  TEST_ASSERT_EQUAL_UINT8_ARRAY(k1, f + 10, 5);
  const uint8_t k2[5] = {0x06, 0x00, 0x91, 0x20, 0x01};
  TEST_ASSERT_EQUAL_UINT8_ARRAY(k2, f + 15, 5);
  // Y la trama se lee a sí misma
  ubx::Parser ps;
  TEST_ASSERT_EQUAL_INT(1, feedAll(ps, f, n));
  TEST_ASSERT_EQUAL_UINT16(14, ps.frame().len);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_build_checksum);
  RUN_TEST(test_pvt_among_nmea);
  RUN_TEST(test_bad_checksum_then_good);
  RUN_TEST(test_split_and_double_sync);
  RUN_TEST(test_too_long_is_skipped);
  RUN_TEST(test_version);
  RUN_TEST(test_valset);
  return UNITY_END();
}
