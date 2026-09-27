# Adapter boundary

These adapters are intentionally placeholders in v0.1.

The Ableton bridge does not allow arbitrary external actions. Future integrations should translate a small, explicit command schema into one transport each:

- **MainStage**: dedicated virtual MIDI port / program changes / CC
- **LumaRig**: authenticated local WebSocket or HTTP commands
- **ProPresenter**: dedicated MIDI or supported network cue transport
- **Planning Center**: server-side authenticated read/import of service plans
- **ChatGPT relay**: authenticated outbound connection from this Mac to a relay, never an open inbound port from the internet

Each adapter should be independently disableable and should never receive arbitrary code from the natural-language parser.
