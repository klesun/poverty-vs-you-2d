
var Util = Util || {};

// This class destiny is to read shmidusic json structure
// and send events to MIDI.js and PianoLayoutPanel

/** @param piano - PianoLayoutPanel instance */
Util.Player = function ($controlCont)
{
    var control = Util.PlaybackControl($controlCont);

    /** @var - a list of objects that have method handleNoteOn() that returns method handleNoteOff() */
    var noteHandlers = [];
    var configConsumer = {
        consumeConfig: (config, callback) => callback()
    };

    var toFloat = fractionString => eval(fractionString);
    var toMillis = Util.toMillis;

    // list of lambdas
    var toBeInterrupted = [];

    /** @param dontExecute - if not true, the scheduled callback will be called even
     * if interrupted pre#devremenno */
    var scheduleInterruptable = function(millis, taskList)
    {
        var interrupted = false;
        var interruptLambda = function() {
            interrupted = true;
            taskList.forEach(t => t.skipWhenInterrupted ? null : t.callback());
        };
        toBeInterrupted.push(interruptLambda);
        setTimeout(function() {
            if (!interrupted) {
                taskList.forEach(t => t.callback());
                var index = toBeInterrupted.indexOf(interruptLambda);
                toBeInterrupted.splice(index, 1);
            }
        }, millis);
    };

    var playNote = function(noteJs, tempo)
    {
        var length = toFloat(noteJs.length) / (noteJs.isTriplet ? 3 : 1);
        var offList = noteHandlers.map(h => h.handleNoteOn(noteJs));

        scheduleInterruptable(toMillis(length, tempo), [{skipWhenInterrupted: false, callback: function()
        {
            // handling note off
            offList.forEach(c => c());
        }}]);
    };

    var stop = function() {
        toBeInterrupted.forEach(c => c());
        toBeInterrupted.length = 0;
    };

    // TODO: rename to playSheetMusic()
    var playGeneralFormat = function (sheetMusic, fileInfo, whenFinished, startIndex)
    {
		whenFinished = whenFinished || ((_) => {});
        startIndex = +startIndex || 0;

        stop();

        var playAtIndex = ((chordIndex) => playGeneralFormat(sheetMusic, fileInfo, whenFinished, chordIndex));

        if (sheetMusic.config.tempo === sheetMusic.config.tempoOrigin) {
            sheetMusic.config.tempo = sheetMusic.config.tempoOrigin * control.getTempoFactor();
        }
        control.setFields(sheetMusic, playAtIndex)
            .setFileInfo(fileInfo) /** @TODO: change to setFileInfo and handle score */
            .setChordIndex(startIndex);

        if (startIndex == 0) {
            control.repaintStaff(sheetMusic);
        }

        configConsumer.consumeConfig(sheetMusic.config.instrumentDict, function()
        {
            var startMillis = window.performance.now() -
                toMillis(sheetMusic.chordList[startIndex].timeFraction, sheetMusic.config.tempo);

            var playNext = function(idx)
            {
                var continuation = (_) => {};
                var timeSkip = 0;

                var tabSwitched = function()
                {
                    stop();
                    var whenBack = function() {
                        document.removeEventListener('visibilitychange', whenBack);
                        playAtIndex(idx);
                    };
                    document.addEventListener('visibilitychange', whenBack);
                };

                document.addEventListener('visibilitychange', tabSwitched);
                var resetListener = _ => document.removeEventListener('visibilitychange', tabSwitched);

                var c = sheetMusic.chordList[idx];
                c['noteList'].forEach(n => playNote(n, sheetMusic.config.tempo));

                var updateSlider = (_) => control
                    .setChordIndex(idx)
                    .setSeconds(toMillis(c.timeFraction, sheetMusic.config.tempo) / 1000.0);

                if (idx + 1 < sheetMusic.chordList.length) {

                    timeSkip = toMillis(sheetMusic.chordList[idx + 1].timeFraction, sheetMusic.config.tempo) -
                            (window.performance.now() - startMillis);

                    continuation = (_) => playNext(idx + 1);
                    if (timeSkip > 0 && idx % 20 === 0 || timeSkip > 250) {
                        continuation = Util.andThen(continuation, _ => updateSlider());
                    }

                } else {
                    timeSkip = 5000; // hope last chord finishes in 5 seconds
                    continuation = whenFinished;
                }

                if (timeSkip > 0) {
                    scheduleInterruptable(timeSkip, [
                        {skipWhenInterrupted: true, callback: continuation},
                        {skipWhenInterrupted: false, callback: resetListener}
                    ]);
                } else {
                    continuation();
                    resetListener();
                }
            };

            playNext(startIndex);
        });
    };

    /** @TODO: move playShmidusic() and playStandardMidiFile() implementations into
     * a separate class which would deal with format differences*/

    /** @param shmidusicJson - json in shmidusic project format */
    var playShmidusic = function (shmidusicJson, fileName, whenFinished) {

        whenFinished = whenFinished || ((_) => {});
        fileName = fileName || 'noNameFile';

		shmidusicJson['staffList'].forEach(function(staff)
        {
            var instrumentDict = {};

            (staff.staffConfig.channelList || [])
                .filter(e => e.channelNumber < 16)
                .forEach((e) => (instrumentDict[e.channelNumber] = e.instrument));

            Util.range(0, 16).forEach(i => (instrumentDict[i] |= 0));

            // flat map hujap
            // tactList not needed for logic, but it increases readability of file A LOT
            var chordList = ('tactList' in staff)
                ? [].concat.apply([], staff['tactList'].map(t => t['chordList']))
                : staff['chordList'];

            if (!staff.millisecondTimeCalculated) {

                var timeFraction = 0;

                chordList.forEach(function(c) {
                    /** @legacy */
                    c.noteList.forEach(function(n) {
                        n.length += '/' + (n.isTriplet ? 3 : 1);
                        delete n.isTriplet;
                    });

                    c.timeFraction = timeFraction;
                    var chordLength = Math.min.apply(null, c.noteList.map(n => toFloat(n.length)));
                    timeFraction += chordLength;
                });

                staff.millisecondTimeCalculated = true;
            }

            playGeneralFormat({
                chordList: chordList,
                config: {
                    tempo: staff.staffConfig.tempo,
                    tempoOrigin: staff.staffConfig.tempo,
                    instrumentDict: instrumentDict
                }
            }, {fileName: fileName, score: 'Ne'}, whenFinished);
        });
    };

    /** @TODO: move format normalization into separate class */
    var playStandardMidiFile = function (smf, fileInfo, whenFinished)
    {
        stop();

        whenFinished = whenFinished || ((_) => {});

        /** @TODO: handle _all_ tempo events, not just first. Should be easy once speed change by user is implemented */
        var tempoEntry = smf.tempoEventList.filter(t => t.time == 0)[0] ||
            smf.tempoEventList[0] || {tempo: 120};
        var division = smf.division * 4;

        var chordList = [];
        var curTime = -100;
        var curChord = [-100, -100];

        smf.noteList.forEach(function(note) {
            note.length = note.duration / division;
            if (note.time == curTime) {
                curChord.noteList.push(note);
            } else {
                curTime = note.time;
                curChord = {noteList: [note], timeFraction: curTime / division};
                chordList.push(curChord);
            }
        });

        control.setNoteCount(smf.noteList.length);

        playGeneralFormat({
            chordList: chordList,
            config: {
                tempo: tempoEntry.tempo,
                tempoOrigin: tempoEntry.tempo,
                instrumentDict: smf.instrumentDict
            }
        }, fileInfo, whenFinished);

        control.setNoteCount(smf.noteList.length);
    };

    // this class shouldn't be instanciated more than once, right?
    // besides, the playing notes are global thing.
    window.onbeforeunload = _ => stop();

    return {
        playShmidusic: playShmidusic,
        playStandardMidiFile: playStandardMidiFile,
        addNoteHandler: h => noteHandlers.push(h),
        addConfigConsumer: cc => (configConsumer = cc)
    };
};