// Pruebas de la prueba de banco (lib/banco), en el ordenador: pio test -e native
#include <string.h>
#include <unity.h>

#include "banco.h"

void setUp() {}
void tearDown() {}

using banco::ImuCheck;
using banco::St;

namespace {
void run(ImuCheck &c, uint32_t &t, uint32_t ms, float ax, float ay, float az, float gx = 0, float gy = 0, float gz = 0) {
  const float a[3] = {ax, ay, az}, g[3] = {gx, gy, gz};
  for (uint32_t end = t + ms; t < end; t += 20) c.sample(a, g, t);
}
}  // namespace

void test_informe_json() {
  banco::Estado e;
  e.fw = "1.0.0";
  e.up = 42;
  e.sd.st = St::Ok;
  strcpy(e.sd.tipo, "SDHC");
  e.sd.gb = 31.9f;
  e.sd.mbs = 9.84f;
  e.gps.st = St::Ok;
  strcpy(e.gps.mod, "NEO-M9N");
  strcpy(e.gps.fw, "SPG 4.04");
  e.gps.pvt = true;
  e.gps.fix = 3;
  e.gps.fixOk = true;
  e.gps.sats = 14;
  e.gps.hacc = 1.8f;
  e.gps.ttff = 34;
  e.imu.st = St::Falla;
  e.imu.msg = "No contesta por el Qwiic (0x6A): revisa el cable entre el GPS y el sensor";
  char buf[640];
  const size_t n = banco::informe(e, buf, sizeof buf);
  TEST_ASSERT_TRUE(n > 0);
  TEST_ASSERT_EQUAL_UINT32(strlen(buf), n);
  TEST_ASSERT_EQUAL_INT(0, strncmp(buf, "@SC {\"v\":1,\"fw\":\"1.0.0\",\"up\":42,", 32));
  TEST_ASSERT_NOT_NULL(strstr(buf, "\"sd\":{\"st\":\"ok\",\"msg\":\"\",\"tipo\":\"SDHC\",\"gb\":31.9,\"mbs\":9.8}"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "\"sats\":14,\"hacc\":1.8,\"ttff\":34}"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "\"imu\":{\"st\":\"falla\""));
  TEST_ASSERT_EQUAL_CHAR('}', buf[n - 1]);
  // Si no cabe, nada a medias
  TEST_ASSERT_EQUAL_UINT32(0, banco::informe(e, buf, 100));
  TEST_ASSERT_EQUAL_CHAR(0, buf[0]);
}

void test_imu_flat_then_tilt() {
  ImuCheck c;
  uint32_t t = 1000;
  c.reset(t);
  run(c, t, 400, 0.1f, -0.1f, 9.8f, 0.3f, -0.2f, 0.1f);
  TEST_ASSERT_TRUE(c.st() == St::Prueba);  // aún no medio segundo quieto
  run(c, t, 200, 0.1f, -0.1f, 9.8f, 0.3f, -0.2f, 0.1f);
  TEST_ASSERT_TRUE(c.st() == St::Ok);
  TEST_ASSERT_FALSE(c.incl());
  // Inclinado 45° sin giro (imposible de verdad, pero no debe contar)
  run(c, t, 200, 6.93f, 0, 6.93f);
  TEST_ASSERT_FALSE(c.incl());
  // Ahora girándolo
  run(c, t, 200, 3.0f, 0, 9.3f, 0, 45.0f, 0);
  run(c, t, 200, 6.93f, 0, 6.93f);
  TEST_ASSERT_TRUE(c.incl());
}

void test_imu_upside_down_is_fine() {
  ImuCheck c;
  uint32_t t = 0;
  c.reset(t);
  run(c, t, 600, 0, 0, -9.8f);
  TEST_ASSERT_TRUE(c.st() == St::Ok);
}

void test_imu_never_still() {
  ImuCheck c;
  uint32_t t = 0;
  c.reset(t);
  run(c, t, 9000, 0, 0, 9.8f, 0, 0, 12.0f);  // girando todo el rato
  TEST_ASSERT_TRUE(c.st() == St::Falla);
  TEST_ASSERT_NOT_NULL(strstr(c.msg(), "giros"));
  // Si luego se queda quieto, se arregla
  run(c, t, 600, 0, 0, 9.8f);
  TEST_ASSERT_TRUE(c.st() == St::Ok);
}

void test_imu_dead_sensor() {
  ImuCheck c;
  uint32_t t = 0;
  c.reset(t);
  run(c, t, 9000, 0, 0, 0);  // todo a cero
  TEST_ASSERT_TRUE(c.st() == St::Falla);
  TEST_ASSERT_NOT_NULL(strstr(c.msg(), "9,8"));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_informe_json);
  RUN_TEST(test_imu_flat_then_tilt);
  RUN_TEST(test_imu_upside_down_is_fine);
  RUN_TEST(test_imu_never_still);
  RUN_TEST(test_imu_dead_sensor);
  return UNITY_END();
}
