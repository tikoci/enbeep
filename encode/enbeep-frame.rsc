# enbeep-frame.rsc - general MFSK-16 frame encoder, v2 (RouterOS 7).
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
#
# LOAD BY PASTE, NOT /import: on 7.16.2 (RB953GS-5HnT, mipsbe),
# :global functions defined via /import silently cannot call other
# globals (nested calls no-op, no error). CLI-pasted definitions nest
# fine. Single-line transport: strip #-lines, join with spaces (the
# trailing `;` on every block closer makes this safe).
#
# Validated: CHR 7.26beta3 (dry-run logic) + RB1100AHx4 (air) +
# RB953GS-5HnT 7.16.2 (paste-load only; piezo attacks slowly - short
# tones ~15 dB under syncs, edge sweep tone may merge). See notes.

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
    :local bytes $1; :local sym $2; :local dry $3; :local tone $4;
    :local base 2000; :local step 100; :local sync 4000;
    :local len [:len $bytes];
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
        $enbeepTone ($base + ((($b / 16)) * $step)) $sym $dry $tone;
        $enbeepTone ($base + ((($b % 16)) * $step)) $sym $dry $tone;
    };
    :if ($dry = "yes") do={ :put "SYNC:1000ms"; } else={ :beep frequency=$sync length=1s; :delay 1s; };
};

:global enbeepText do={
    :local text $1; :local sym $2; :local dry $3; :local tone $4;
    $enbeepXmit [:convert $text to=byte-array] $sym $dry $tone;
};

:global enbeepAnnounce do={
    :local ifName $1; :local addrRow $2; :local sym $3; :local tone $4; :local dry $5;
    :local macStr [/interface/get $ifName mac-address];
    :local hexd "";
    :for i from=0 to=([:len $macStr] - 1) do={
        :local c [:pick $macStr $i];
        :if ($c != ":") do={ :set hexd ($hexd . $c); };
    };
    :local mac [:convert $hexd from=hex to=byte-array];
    :local addrStr [/ip/address/get $addrRow address];
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
