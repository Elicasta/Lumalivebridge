# Future ChatGPT relay

The local bridge is already the execution layer.

A future ChatGPT integration should **not** expose Ableton directly to the public internet.

Recommended flow:

```text
ChatGPT / Luma cloud client
        |
        | authenticated command envelope
        v
outbound relay connection from the Mac
        |
        v
Luma Live Bridge validator
        |
        v
Preview / approval policy
        |
        v
Max for Live / LiveAPI
        |
        v
Ableton Live
```

The relay should only carry the same allowlisted command objects accepted by `device/validator.js`.

The cloud side should never be able to:

- send shell commands
- submit arbitrary LiveAPI paths
- read arbitrary local files
- execute arbitrary JavaScript or Max code
- bypass the local validator

For unattended performance control, use a separate explicit permission mode rather than silently removing Preview -> Apply.
