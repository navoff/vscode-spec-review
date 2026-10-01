# Smart toaster T-800: firmware

The toaster must toast bread, predict its owner's mood and under no circumstances set the kitchen on fire. This document describes the first firmware version.

## Goals

- Toast bread to one of five levels: `pale`, `golden`, `brown`, `carbon`, `philosophical`.
- Detect the owner's mood from how hard the lever is pressed.
- Send a Telegram notification when the toast is ready, and one to the police when it has burnt.

## Architecture

The firmware consists of three modules that talk through the `bread_msgq` message queue.

### Heating module

Drives the coil through PWM. The temperature is read from the thermocouple every **50 ms** and smoothed with a first-order filter.

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

Recipes live in flash as TLV records. A recipe is a toasting level, a time and the owner's name. At most 16 recipes: a toaster should not have more owners than that.

{% cut "Record format" %}

```text
+------+------+----------------+
| tag  | len  | value          |
| 1 B  | 1 B  | len bytes      |
+------+------+----------------+
```

Tags: `0x01` - level, `0x02` - time in seconds, `0x03` - owner's name in UTF-8.

{% endcut %}

## Safety

If the filtered temperature exceeds 300 °C, the coil is switched off, the lever pops up and `FIRE_AVOIDED` is written to the log. Switching back on is possible only after a reboot and a sincere confession in the app.

## Out of scope for the first version

- Baguettes longer than 40 cm.
- Toasting by voice command.
- Syncing recipes between the toasters of one family.
