# enbeep.rsc - general MFSK-16 frame encoder, v2 (RouterOS 7).
#
# Frame (data tones at symbol length $sym; 2000+100*n Hz, high nibble first):
#   PRE  2s @ 4000 Hz + 16-tone sweep 2000..3500 (per-tx calibration)
#   SEP  1s @ 4000 Hz
#   DATA LEN, payload bytes, FLETCHER16 (2 tones/byte, no SOF/EOF - the 1s
#        syncs are the delimiters; 1-tone 4000 Hz markers would merge into them)
#   END  1s @ 4000 Hz
# v2 replaces the v1 byte-sum with Fletcher-16 (arithmetic only, no bitwise
# ops needed) after a real 1/256-class false-accept on air.
# Tone length may be shorter than the slot ($tone < $sym) to leave a decay
# gap against piezo ring-down; syncs always play full-length.
#
# Usage (paste whole file, or transport minified - no file write needed):
#   $enbeepAnnounce "ether1" 0 200ms 200ms no   # MAC+IPv4+cpu frame, live
#   $enbeepAnnounce "ether1" 0 200ms 150ms no   # same, 50 ms decay gap
#   $enbeepText "Hello" 200ms 200ms no          # text frame, live
#   ... yes                                     # dry-run: :put trace, silent
# Unload (globals are RAM-only, but you can drop them without a reboot):
#   /system/script/environment/remove [find where name~"enbeep"]
#
# Nested globals follow the scripting manual: each body re-declares the
# globals it calls (:global enbeepTone; etc.), so [:parse ...] and fetch
# loading resolve the same way a CLI paste does. Load-method history and
# the remaining 7.16 re-test live in encode/README.md; until then, paste
# remains the verified recipe.
# Single-line transport: strip #-lines, join with spaces (the trailing
# `;` on every block closer makes this safe).
#
# Validated: CHR 7.26beta3 (dry-run logic, incl. API-loaded nesting) +
# RB1100AHx4 (air) + RB953GS-5HnT 7.16.2 (paste-load only; piezo attacks
# slowly - short tones ~15 dB under syncs, edge sweep tone may merge).
# CHR 7.25 x86 also transmits Hello through a patched QEMU virtual
# speaker into the offline decoder (bun run test:chr; docs/CHR-BEEP.md).

:global enbeepTone do={
    :local freq $1; :local sym $2; :local dry $3; :local tone $4;
    :if ($dry = "yes") do={
        :put ("T:" . $freq);
    } else={
        :beep frequency=$freq length=$tone;
        :delay $sym;
    };
};

:global enbeepXmit do={
    :global enbeepTone;
    :local bytes $1; :local sym $2; :local dry $3; :local tone $4;
    :local len [:len $bytes];
    :if ($len < 1 || $len > 255) do={ :error ("enbeep: payload is " . $len . " bytes, want 1..255"); };
    # Args arrive as strings, and [:totime "200"] silently means 200
    # SECONDS, so validate into time locals with a sanity range: bare
    # numbers (or hour-long typos) fail fast instead of beeping for
    # hours. The original strings still feed :delay/:beep, which coerce.
    :local symT; :local toneT;
    :do { :set symT [:totime $sym]; :set toneT [:totime $tone]; } on-error={ :error "enbeep: sym and tone must be times, e.g. 200ms 200ms"; };
    :if ($symT < 50ms || $symT > 10s || $toneT < 1ms || $toneT > 10s) do={ :error "enbeep: sym/tone out of range (sym 50ms..10s, tone 1ms..10s)"; };
    :if ($toneT > $symT) do={ :error "enbeep: tone must not exceed sym (see header)"; };
    :local base 2000; :local step 100; :local sync 4000;
    :local acc [:convert "" to=byte-array];
    :set acc ($acc, $len);
    :for i from=0 to=($len - 1) do={ :set acc ($acc, ($bytes->$i)); };
    :local s1 0; :local s2 0;
    :for i from=0 to=([:len $acc] - 1) do={
        :set s1 (($s1 + ($acc->$i)) % 255);
        :set s2 (($s2 + $s1) % 255);
    };
    :if ($dry = "yes") do={
        :put ("FRAME len=" . $len . " f1=" . $s1 . " f2=" . $s2 . " tone=" . $tone);
    };
    :if ($dry = "yes") do={ :put "SYNC:2000ms"; } else={ :beep frequency=$sync length=2s; :delay 2s; };
    :for n from=0 to=15 do={ $enbeepTone ($base + ($n * $step)) $sym $dry $tone; };
    :if ($dry = "yes") do={ :put "SYNC:1000ms"; } else={ :beep frequency=$sync length=1s; :delay 1s; };
    :local run [:convert "" to=byte-array];
    :for i from=0 to=([:len $acc] - 1) do={ :set run ($run, ($acc->$i)); };
    :set run ($run, $s1);
    :set run ($run, $s2);
    :for i from=0 to=([:len $run] - 1) do={
        :local b ($run->$i);
        # Spaced / and % are integer division and remainder (RouterOS
        # numbers are 64-bit ints); unspaced 65/16 parses as a path.
        $enbeepTone ($base + ((($b / 16)) * $step)) $sym $dry $tone;
        $enbeepTone ($base + ((($b % 16)) * $step)) $sym $dry $tone;
    };
    :if ($dry = "yes") do={ :put "SYNC:1000ms"; } else={ :beep frequency=$sync length=1s; :delay 1s; };
};

:global enbeepText do={
    :global enbeepXmit;
    :local text $1; :local sym $2; :local tone $3; :local dry $4;
    $enbeepXmit [:convert $text to=byte-array] $sym $dry $tone;
};

:global enbeepAnnounce do={
    :global enbeepXmit;
    :local ifName $1; :local addrRow $2; :local sym $3; :local tone $4; :local dry $5;
    :local macStr "";
    :do { :set macStr [/interface/get $ifName mac-address]; } on-error={ :error ("enbeep: no such interface: " . $ifName); };
    :local hexd "";
    :for i from=0 to=([:len $macStr] - 1) do={
        :local c [:pick $macStr $i];
        :if ($c != ":") do={ :set hexd ($hexd . $c); };
    };
    :local mac [:convert $hexd from=hex to=byte-array];
    :local addrStr "";
    :do { :set addrStr [/ip/address/get $addrRow address]; } on-error={ :error ("enbeep: no such address row: " . [:tostr $addrRow]); };
    :local ipStr [:pick $addrStr 0 [:find $addrStr "/"]];
    :local payload [:convert "" to=byte-array];
    :for i from=0 to=5 do={ :set payload ($payload, ($mac->$i)); };
    :local rest $ipStr;
    :for k from=0 to=2 do={
        :local dot [:find $rest "."];
        :set payload ($payload, [:tonum [:pick $rest 0 $dot]]);
        :set rest [:pick $rest ($dot + 1) [:len $rest]];
    };
    :set payload ($payload, [:tonum $rest]);
    :set payload ($payload, [:tonum [/system/resource/get cpu-load]]);
    :if ($dry = "yes") do={ :put ("META mac=" . $macStr . " ip=" . $ipStr); };
    $enbeepXmit $payload $sym $dry $tone;
};
