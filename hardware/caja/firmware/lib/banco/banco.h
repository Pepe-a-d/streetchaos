// Prueba de banco (hito H1): el estado de cada pieza y el informe que lee la página de instalación.
// C++ puro, sin Arduino, para probarlo en el ordenador.
//
// El informe es una línea por segundo: «@SC » + JSON. La página la lee por el USB; como se repite,
// da igual cuándo se conecte. Lo demás que se escriba por el puerto (líneas sin «@SC ») es para leerlo
// una persona, en «Detalles».
#pragma once
#include <stddef.h>
#include <stdint.h>

namespace banco {

enum class St : uint8_t { Prueba, Ok, Falla };
const char *stName(St s);

struct Sd {
  St st = St::Prueba;
  const char *msg = "";
  char tipo[8] = "";
  float gb = 0;   // GB de la tarjeta (de 10^9 bytes, como en la etiqueta)
  float mbs = 0;  // MB/s al escribir
};

struct Gps {
  St st = St::Prueba;
  const char *msg = "";
  char mod[24] = "";  // «NEO-M9N»
  char fw[24] = "";   // «SPG 4.04»
  bool pvt = false;   // ya llegan posiciones (NAV-PVT)
  uint8_t fix = 0;    // 0 nada, 2 2D, 3 3D
  bool fixOk = false;
  uint8_t sats = 0;
  float hacc = 0;     // m
  int32_t ttff = -1;  // s hasta la primera posición; -1 todavía no
};

struct Imu {
  St st = St::Prueba;
  const char *msg = "";
  uint8_t addr = 0;
  float a[3] = {0, 0, 0};  // m/s², con la gravedad
  float g[3] = {0, 0, 0};  // °/s
  bool incl = false;       // ya se ha inclinado y los números cambiaron
};

struct Estado {
  const char *fw = "";
  uint32_t up = 0;  // s encendida
  Sd sd;
  Gps gps;
  Imu imu;
};

// Escribe la línea del informe (sin salto de línea). Devuelve la longitud, o 0 si no cabe
size_t informe(const Estado &e, char *out, size_t cap);

// Comprueba el sensor con lo que mide: primero quieto (la gravedad da unos 9,8 m/s² y los giros, casi
// 0); luego, inclinado más de 30° con giro de verdad
class ImuCheck {
 public:
  static constexpr float G_MIN = 9.0f, G_MAX = 10.6f;  // m/s² en reposo
  static constexpr float GYRO_QUIETO = 4.0f;           // °/s en reposo
  static constexpr uint32_t QUIETO_MS = 500;           // tanto tiempo quieto para darlo por bueno
  static constexpr uint32_t PLAZO_MS = 8000;           // sin quedarse quieto en este tiempo: FALLA
  static constexpr float INCL_GRADOS = 30.0f;
  static constexpr float GIRO_INCL = 20.0f;            // °/s de pico al inclinarlo

  void reset(uint32_t ms);
  void sample(const float a[3], const float g[3], uint32_t ms);
  St st() const { return st_; }
  const char *msg() const { return msg_; }
  bool incl() const { return incl_; }

 private:
  St st_ = St::Prueba;
  const char *msg_ = "";
  bool incl_ = false;
  uint32_t t0_ = 0, quietoDesde_ = 0;
  bool quieto_ = false;
  float acc_[3] = {0, 0, 0};
  uint32_t nAcc_ = 0;
  float g0_[3] = {0, 0, 1};
  float giroMax_ = 0;
  uint32_t malG_ = 0, malGiro_ = 0;
};

}  // namespace banco
