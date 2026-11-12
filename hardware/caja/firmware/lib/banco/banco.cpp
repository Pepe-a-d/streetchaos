#include "banco.h"

#include <math.h>
#include <stdarg.h>
#include <stdio.h>

namespace banco {

const char *stName(St s) {
  switch (s) {
    case St::Ok: return "ok";
    case St::Falla: return "falla";
    default: return "prueba";
  }
}

namespace {
// Los números sin «nan» ni «inf», que no son JSON
float fin(float x) { return isfinite(x) ? x : 0.0f; }

struct Out {
  char *p;
  size_t cap, n = 0;
  bool ok = true;
  void add(const char *fmt, ...) __attribute__((format(printf, 2, 3)));
};

void Out::add(const char *fmt, ...) {
  if (!ok) return;
  va_list ap;
  va_start(ap, fmt);
  int k = vsnprintf(p + n, cap - n, fmt, ap);
  va_end(ap);
  if (k < 0 || (size_t)k >= cap - n) {
    ok = false;
    return;
  }
  n += (size_t)k;
}

float norm3(const float v[3]) { return sqrtf(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); }
}  // namespace

size_t informe(const Estado &e, char *out, size_t cap) {
  if (!cap) return 0;
  Out o{out, cap};
  o.add("@SC {\"v\":1,\"fw\":\"%s\",\"up\":%lu", e.fw, (unsigned long)e.up);
  o.add(",\"sd\":{\"st\":\"%s\",\"msg\":\"%s\",\"tipo\":\"%s\",\"gb\":%.1f,\"mbs\":%.1f}", stName(e.sd.st), e.sd.msg, e.sd.tipo, fin(e.sd.gb), fin(e.sd.mbs));
  o.add(",\"gps\":{\"st\":\"%s\",\"msg\":\"%s\",\"mod\":\"%s\",\"fwv\":\"%s\",\"pvt\":%d,\"fix\":%u,\"fixok\":%d,\"sats\":%u,\"hacc\":%.1f,\"ttff\":%ld}",
        stName(e.gps.st), e.gps.msg, e.gps.mod, e.gps.fw, e.gps.pvt ? 1 : 0, (unsigned)e.gps.fix, e.gps.fixOk ? 1 : 0, (unsigned)e.gps.sats, fin(e.gps.hacc), (long)e.gps.ttff);
  o.add(",\"imu\":{\"st\":\"%s\",\"msg\":\"%s\",\"addr\":%u,\"a\":[%.2f,%.2f,%.2f],\"g\":[%.1f,%.1f,%.1f],\"incl\":%d}}", stName(e.imu.st), e.imu.msg, (unsigned)e.imu.addr,
        fin(e.imu.a[0]), fin(e.imu.a[1]), fin(e.imu.a[2]), fin(e.imu.g[0]), fin(e.imu.g[1]), fin(e.imu.g[2]), e.imu.incl ? 1 : 0);
  if (!o.ok) {
    out[0] = 0;
    return 0;
  }
  return o.n;
}

void ImuCheck::reset(uint32_t ms) {
  st_ = St::Prueba;
  msg_ = "";
  incl_ = false;
  t0_ = ms;
  quieto_ = false;
  nAcc_ = 0;
  acc_[0] = acc_[1] = acc_[2] = 0;
  giroMax_ = 0;
  malG_ = malGiro_ = 0;
}

void ImuCheck::sample(const float a[3], const float g[3], uint32_t ms) {
  const float na = norm3(a), ng = norm3(g);
  const bool gBien = na >= G_MIN && na <= G_MAX;
  const bool giroBien = ng < GYRO_QUIETO;

  if (st_ != St::Ok) {
    if (gBien && giroBien) {
      if (!quieto_) {
        quieto_ = true;
        quietoDesde_ = ms;
        nAcc_ = 0;
        acc_[0] = acc_[1] = acc_[2] = 0;
      }
      for (int i = 0; i < 3; i++) acc_[i] += a[i];
      nAcc_++;
      if (ms - quietoDesde_ >= QUIETO_MS && nAcc_ > 0) {
        const float m[3] = {acc_[0] / nAcc_, acc_[1] / nAcc_, acc_[2] / nAcc_};
        const float nm = norm3(m);
        for (int i = 0; i < 3; i++) g0_[i] = m[i] / nm;
        st_ = St::Ok;
        msg_ = "";
        giroMax_ = 0;
      }
    } else {
      quieto_ = false;
      if (!gBien) malG_++;
      if (!giroBien) malGiro_++;
    }
    if (st_ != St::Ok && ms - t0_ >= PLAZO_MS) {
      st_ = St::Falla;
      msg_ = malG_ >= malGiro_ ? "En reposo no da unos 9,8 m/s²: déjalo quieto sobre la mesa y repite la prueba"
                               : "En reposo los giros no se quedan en 0: déjalo quieto sobre la mesa y repite la prueba";
    }
    return;
  }

  // Ya bueno: falta inclinarlo
  if (ng > giroMax_) giroMax_ = ng;
  if (!incl_ && na >= 8.5f && na <= 11.0f) {
    const float c = (a[0] * g0_[0] + a[1] * g0_[1] + a[2] * g0_[2]) / na;
    const float ang = acosf(c > 1 ? 1 : (c < -1 ? -1 : c)) * 57.29578f;
    if (ang > INCL_GRADOS && giroMax_ > GIRO_INCL) incl_ = true;
  }
}

}  // namespace banco
