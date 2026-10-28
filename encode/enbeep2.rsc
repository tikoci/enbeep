# LEGACY / BROKEN on RouterOS 7 — do not use. Superseded by enbeep-frame.rsc.
# (Its +100 Hz / delay-rounding notes did not reproduce — see README measured findings.)
# Usage: [$beepSend "HELLO"]
:global enbeeo do={
    :local input $1;

    # Frequency Configuration
    :local baseFreq 2000;
    :local step 100;
    :local toneLen 50ms;        # tone duration per symbol
    # IMPORTANT – RouterOS 7 behaviour:
    #   • :beep is NON-BLOCKING (changed from RouterOS <7).  The command
    #     returns immediately; the hardware plays the tone in the background.
    #   • :delay values below ~200ms appear to be rounded toward 0, making
    #     sub-200ms inter-symbol gaps unreliable.
    #   • Minimum reliable symbol duration (beep + gap) is approximately 200ms.
    # HARDWARE NOTE (MikroTik piezo):
    #   Measured +100 Hz systematic upward frequency offset vs. the requested
    #   frequency (e.g. :beep frequency=2000 → 2100 Hz actual output).
    #   The decoder compensates via band-restricted FFT and calibration offset.
    :local startTone 4000;

    # ASCII Lookup Table (Characters 32 to 126)
    :local table " !\"#\$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_abcdefghijklmnopqrstuvwxyz{|}~";

    # 1. Send Start of Frame (SOF)
    :beep frequency=$startTone length=$toneLen;

    # 2. Process String
    :for i from=0 to=([:len $input] - 1) do={
        :local char [:pick $input $i];
        :local val ([:find $table $char] + 32);

        # If character not in table, default to null/0
        :if ([:len $val] = 0) do={ :set val 0 };

        # Split into nibbles (4-bit chunks)
        :local high ($val / 16);
        :local low ($val % 16);

        # Send High Nibble
        :beep frequency=($baseFreq + ($high * $step)) length=$toneLen;

        # Send Low Nibble
        :beep frequency=($baseFreq + ($low * $step)) length=$toneLen;
    }

    # 3. Send End of Frame (Optional secondary SOF)
    :beep frequency=$startTone length=$toneLen;
}

