"""Speak slide 08's answers into WAV files the fake microphone of Chromium can play (answers-08.json).

    <venv with piper-tts>/bin/python -I deck/cf11/tools/record/speak.py <voice.onnx> <out dir>

An offline TTS voice (any Russian .onnx voice of that package) reads each answer with a pause after every sentence
(the app's recognition writes the speech down after each pause); ffmpeg makes it 48 kHz mono 16-bit with 0.6 s of
quiet before and 2 s after. The take of 21.10.2026 used ru_RU-denis-medium: with ru_RU-irina-medium the app's
recognition wrote «эс кью эль» as «SQ-VIL»; denis and dmitri were written down as «SQL».
"""
import json
import subprocess
import sys
import wave
from pathlib import Path

from piper import PiperVoice
from piper.config import SynthesisConfig

HERE = Path(__file__).resolve().parent


def main():
    voice = PiperVoice.load(sys.argv[1])
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    answers = json.loads((HERE / 'answers-08.json').read_text(encoding='utf-8'))['answers']
    config = SynthesisConfig(length_scale=1.02, noise_scale=0.6, noise_w_scale=0.8)
    for number, text in answers.items():
        raw = out / f'q{number}-raw.wav'
        with wave.open(str(raw), 'wb') as wav:
            first = True
            for chunk in voice.synthesize(text, syn_config=config):
                if first:
                    wav.setnchannels(chunk.sample_channels)
                    wav.setsampwidth(chunk.sample_width)
                    wav.setframerate(chunk.sample_rate)
                    first = False
                wav.writeframes(chunk.audio_int16_bytes)
                # A breath after each sentence: 0.75 s of quiet.
                wav.writeframes(b'\x00\x00' * int(chunk.sample_rate * 0.75))
        final = out / f'q{number}.wav'
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(raw),
                        '-af', 'adelay=600:all=1,apad=pad_dur=2,loudnorm=I=-18:TP=-2',
                        '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', str(final)], check=True)
        with wave.open(str(final)) as w:
            print(f'q{number}: {w.getnframes() / w.getframerate():.1f} s -> {final}')
        raw.unlink()


if __name__ == '__main__':
    main()
