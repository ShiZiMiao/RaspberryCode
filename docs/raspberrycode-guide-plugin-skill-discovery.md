# RaspberryCode Guide Plugin Skill Discovery

`raspberrycode-guide` is an official content-only plugin that provides configuration and
self-diagnosis skills. It is default-enabled in the CLI/bootstrap official plugin
definitions, so first launch users should see its skills without manually enabling
the plugin.

Desktop skill management and chat `$` skill suggestions use the services-side
plugin skill scanner, not the CLI bootstrap scanner. That services path keeps a
small mirror of the default-enabled official plugin ids because it reads the
official plugin cache directly. The mirror must include every default-enabled
official content plugin:

- `document-skills@raspberrycode-plugins-official`
- `browser-use@raspberrycode-plugins-official`
- `skill-creator@raspberrycode-plugins-official`
- `raspberrycode-guide@raspberrycode-plugins-official`

Bugfix note: if `raspberrycode-guide` is omitted from the services mirror, the plugin may
still appear enabled in plugin management while its `diagnosing-*` skills are
missing from Skills management and `$` suggestions. Suppressed built-ins still
take precedence and must prevent the plugin from contributing skills.
