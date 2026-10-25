/**
 * 10ms of silence as a data URI, used to unlock mobile audio (产品规划 3.2.9).
 *
 * Built from bytes on purpose. The first version of this was a base64 literal that
 * got line-wrapped by hand and silently decoded to 116 of the 124 bytes, so the
 * "unlock" played nothing and the autoplay bug came back with no error to follow.
 * Assembled here it is verifiable, and there is nothing to mis-transcribe.
 */
export function silentWav(): string {
  const samples = 80; // 8kHz × 10ms, 8-bit mono
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i);
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format: PCM
  view.setUint16(22, 1, true); // channels: mono
  view.setUint32(24, 8000, true); // sample rate
  view.setUint32(28, 8000, true); // byte rate (8-bit × 8000 Hz × 1ch)
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(0x80, 44); // 8-bit unsigned silence is the mid value, not zero

  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${btoa(binary)}`;
}
