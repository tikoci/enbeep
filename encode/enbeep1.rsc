# LEGACY / BROKEN on RouterOS 7 — do not use. Superseded by enbeep-frame.rsc.
# (:beep is non-blocking in RouterOS 7; this file assumes RouterOS 6 timing.)
# Usage: [$beepSend "HELLO"]
:global enbeeo do={
    :local input $1;
    # Frequency Configuration
    :local baseFreq 2000;
    :local step 100;
    :local toneLen 50ms;
    :local startTone 4000;

    # ASCII Lookup Table (Characters 32 to 126)
    :local table " !\"#\$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_\abcdefghijklmnopqrstuvwxyz{|}~";

    # 1. Send Start of Frame (SOF)
    :beep frequency=$startTone length=$toneLen;
    :delay $toneLen;

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
        :delay $toneLen;

        # Send Low Nibble
        :beep frequency=($baseFreq + ($low * $step)) length=$toneLen;
        :delay $toneLen;
    }
    
    # 3. Send End of Frame (Optional secondary SOF)
    :beep frequency=$startTone length=$toneLen;
}
