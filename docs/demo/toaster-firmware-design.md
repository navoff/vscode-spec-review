# Smart toaster T-800: firmware

The toaster must toast bread, predict its owner's mood and under no circumstances set the kitchen on fire. This document describes the first firmware version.

## Goals

- Toast bread to one of five levels: `pale`, `golden`, `brown`, `carbon`, `philosophical`.
- Detect the owner's mood from how hard the lever is pressed.
- Control the toaster over Bluetooth LE from the phone app: start and cancel toasting, pick the level and read the current state.
- Send a Telegram notification when the toast is ready, and one to the police when it has burnt.

## Architecture

The firmware consists of three modules that talk through the `bread_msgq` message queue.

### Heating module

Drives the coil through PWM. The temperature is read from the thermocouple every **100 ms** and smoothed with a first-order filter.

```c
static int heat_tick(struct toaster *t)
{
    int temp = thermocouple_read(t->tc);
    t->filtered = (t->filtered * 7 + temp) / 8;
    return pwm_set(t->pwm, controller_step(t, t->filtered));
}
```

### Mood module

The force on the lever is measured by a strain gauge. Mapping table:

| Force, N | Mood | Level adjustment |
|---|---|---|
| < 2 | sleepy | +1 |
| 2-5 | normal | 0 |
| 5-10 | cheerful | -1 |
| > 10 | anxious | no bread dispensed |

### Notification module

{% note warning "Risk" %}
The police notification goes through an SMS modem. Make sure the number is not confused with the pizza delivery one.
{% endnote %}

## Recipe storage

Recipes live in flash as Protocol Buffers messages encoded with nanopb, each prefixed with its length as a varint. A recipe is a toasting level, a time and the owner's name. At most 16 recipes: a toaster should not have more owners than that.

{% cut "Record format" %}

```proto
syntax = "proto3";

enum Level {
  PALE = 0;
  GOLDEN = 1;
  BROWN = 2;
  CARBON = 3;
  PHILOSOPHICAL = 4;
}

message Recipe {
  Level level = 1;
  uint32 time_s = 2;  // toasting time in seconds
  string owner = 3;   // owner's name, UTF-8, at most 32 bytes (nanopb max_size)
}
```

Records are written one after another: a varint length, then the encoded `Recipe`. Unknown fields are skipped on read, so new fields can be added without migrating the flash.

{% endcut %}

## Safety

If the filtered temperature exceeds 300 °C, the coil is switched off, the lever pops up and `FIRE_AVOIDED` is written to the log. Switching back on is possible only after a reboot and a sincere confession in the app.

## Out of scope for the first version

- Baguettes longer than 40 cm.
- Toasting by voice command.
- Syncing recipes between the toasters of one family.
