/** Live signals that drive the avatar (mutated every frame by the voice engine, read by the avatar's render loop). */
export const avatarSignals = {
  mouth: 0, //  0..1 how open the mouth is (speech loudness envelope)
  round: 0, //  0..1 lips rounded (o/u sounds: low-frequency energy)
  wide: 0, //   0..1 lips spread (e/s sounds: high-frequency energy)
  user: 0, //   0..1 the user's mic level (she listens / nods)
  live: false, // true while real audio analysis is running (otherwise the avatar synthesises mouth movement)
};
