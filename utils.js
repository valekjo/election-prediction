import fs from 'fs';
import util from 'util';

export const readFile = util.promisify(fs.readFile);
export const writeFile = util.promisify(fs.writeFile);

const readCsvToJsonLines = async (filename) => {
    const data = await readFile(filename, 'utf-8');
    const lines = data.split('\n').map(line => line.trim());
    const header = lines.shift().split(';');
    return lines.map(line => {
        const row = {};
        const cells = line.split(';');
        // For lines that don't match, return null
        if (cells.length !== header.length) {
            return null;
        }
        cells.forEach((cell, index) => {
            row[header[index]] = parseInt(cell);
        })
        return row;
    })
    // Skip not matching lines
    .filter(Boolean);
};

export const getSizeClass = (size) => Math.floor(size / 100);

const transformUnit = (line, getVotes) => {
    const totalVoters = parseInt(line.VOL_SEZNAM);
    const totalVotes = parseInt(line.VYD_OBALKY);
    const votes = getVotes(line);
    const unit = {
        // _rawData: line,
        // Unique identifier of unit
        id: `${line.OKRES}-${line.OBEC}-${line.OKRSEK}`,
        // Level of area
        l1: line.OKRES,
        l2: line.OBEC,
        l3: line.OKRSEK,
        // Total number of voters
        totalVoters,
        sizeClass: getSizeClass(totalVoters),
        // Total number of votes
        totalVotes,
        // Array of votes for candidates
        votes,
        votesRatio: votes.map(x => totalVotes === 0 ? 0 : x / totalVotes),
    };

    return unit;
}

export const meanSquareError = (a, b) => {
    let error = 0;
    for (let i = 0; i < a.length; i++) {
        error += (a[i] - b[i]) ** 2
    }
    return error / a.length;
}

// Get most similar unit from reference units
const getBestMatchByErrorSize = (unit, referenceUnits) => {
   const bestMatch = referenceUnits.map((u => { 
        // Add size anducast
        const votesError = meanSquareError(unit.votesRatio.map(x => x * 200), u.votesRatio.map(x => x * 200));
        const attendanceA = unit.totalVotes / unit.totalVoters;
        const attendanceB = u.totalVotes / u.totalVoters;
        const attendanceError = Math.sqrt(( attendanceA * 200 - attendanceB * 200 ) ** 2)
        // const attendanceError = 0;
        return {
            unit: u, 
            error: votesError + attendanceError,
        }; }))
        .sort((a, b) => a.error - b.error)
        [0];
    return bestMatch.unit;
}

/**
 * Get the most similar unit from reference units.
 * 
 * The most important part of prediction, with most important assumptions, that people tend to vote the same
 * in places that are close to each other and of the same size.
 * 
 */
const getBestMatch = (unit, referenceUnits) => {
    const preferenceFilters = [
        // Stejna velikost, stejna obec
        ({sizeClass, l2}) => unit.l2 === l2 && sizeClass === unit.sizeClass,
        // Stejna velikost, stejny okres
        ({sizeClass, l1}) => unit.l1 === l1 && sizeClass === unit.sizeClass,
        // Stejna obec
        ({l2}) => unit.l2 === l2,
        // Stejny okres
        ({l1}) => unit.l1 === l1,
        // Stejna velikost
        ({sizeClass}) => unit.sizeClass === sizeClass
    ];
    for(const filter of preferenceFilters) {
        const matchedUnits = referenceUnits.filter(filter);
        if (matchedUnits.length > 0) {
            // console.log(matchedUnits.length);
            return getBestMatchByErrorSize(unit, matchedUnits);
        }
    }
    return getBestMatchByErrorSize(unit, referenceUnits);
}

// Project result of given unit
// Unit is historic, referenceUnit is current
const predictUnitFromReference = (unit, referenceUnit) => {
    // Project total votes based on attendance in reference unit - assume the same percentage
    const totalVotes = (referenceUnit.totalVotes * unit.totalVoters / referenceUnit.totalVoters);
    // The ratio of votes is projected to be the same as in the reference unit
    const votesRatio = referenceUnit.votesRatio.map(x => x);
    // Votes are respective portion of total votes
    const votes = votesRatio.map(x => x * totalVotes);
    return {
        id: unit.id,
        referenceUnitId: referenceUnit.id,
        totalVoters: unit.totalVoters,
        totalVotes,
        votes,
        votesRatio,
    }
}

export const sumResults = (units) => {
    const emptyVotes = units[0].votes.map(x => 0);
    const results = {
        totalVoters: 0,
        totalVotes: 0,
        votes: emptyVotes,
    };
    units.forEach(unit => {
        results.totalVoters += unit.totalVoters;
        results.totalVotes += unit.totalVotes;
        results.votes = unit.votes.map((n, i) => n + results.votes[i]);
    });
    results.votesRatio = results.votes.map(x => results.totalVotes === 0 ? 0 : x / results.totalVotes);
    return results;
}

const mapById = (units) => {
    const result = {};
    units.forEach(unit => {
        result[unit.id] = unit;
    });
    return result;
}

const predictFromDataset = (historicData, partialCurrentData) => {
    const historicDataMap = mapById(historicData);
    const partialCurrentDataMap = mapById(partialCurrentData);

    // Historic data on the units we have in current data
    const partialHistoricData = historicData.filter((unit) => !!partialCurrentDataMap[unit.id]);

    // Ids of all units
    const unitIds = Object.keys(historicDataMap);
    const predictedData = unitIds.map((unitId) => {
        // If we already have data for the unit, just take it's value as prediction (it is what it is)
        if (partialCurrentDataMap[unitId]) return partialCurrentDataMap[unitId];

        // Otherwise we find the unit that best matched this unit historically
        const unitInHistory = historicDataMap[unitId];
        const referenceUnitInHistory = getBestMatch(unitInHistory, partialHistoricData);

        // And from this best matching unit's current state, we predict the current state of unit
        const referenceUnit = partialCurrentDataMap[referenceUnitInHistory.id];
        return predictUnitFromReference(unitInHistory, referenceUnit); 
    });

    // And then we just sum results of individual units
    return sumResults(predictedData);
}

const combinePredictions = (predictions) => {
    return sumResults(predictions);
}

export const predictFromDatasets = (historicDatasets, observedData) => {
    const predictions = historicDatasets.map((dataset) => predictFromDataset(dataset, observedData));
    const prediction = combinePredictions(predictions);
    return prediction;
}

export const loadHistoricDatasets = async () => {
    const rawData2018 = await readCsvToJsonLines('./data/prez-2018.csv');
    const rawData2023 = await readCsvToJsonLines('./data/prez-2023.csv');

    const firstRound2018 = rawData2018.filter(row => row.CHYBA === 0 && row.KOLO === 1).map((line) => transformUnit(line, (line) => [
        line.HLASY_01,
        line.HLASY_02,
        line.HLASY_03,
        line.HLASY_04,
        line.HLASY_05,
        line.HLASY_06,
        line.HLASY_07,
        line.HLASY_08,
        line.HLASY_09,
        line.VYD_OBALKY - line.PL_HL_CELK,
    ]));
    const secondRound2018 = rawData2018.filter(row => row.CHYBA === 0  &&  row.KOLO === 2).map((line) => transformUnit(line, (line) => [
        line.HLASY_07,
        line.HLASY_09,
        line.VYD_OBALKY - line.PL_HL_CELK,
    ]));

    const firstRound2023 = rawData2023.filter(row => row.CHYBA === 0 && row.KOLO === 1).map((line) => transformUnit(line, (line) => [
        line.HLASY_01,
        line.HLASY_02,
        line.HLASY_03, // Stredula
        line.HLASY_04,
        line.HLASY_05,
        line.HLASY_06,
        line.HLASY_07,
        line.HLASY_08,
        line.HLASY_09,
        line.VYD_OBALKY - line.PL_HL_CELK,
    ]));

    return {
        firstRound2018,
        secondRound2018,
        firstRound2023
    };
}

export const CANDIDATE_NAMES = {
    SECOND_ROUND_2018: [
        'Zeman',
        'Drahoš',
        'Neplatné hlasy',
    ],
    FIRST_ROUND_2023: [
        'Fischer',
        'Bašta',
        'Středula',
        'Pavel',
        'Zima',
        'Nerudová',
        'Babiš',
        'Diviš',
        'Hilšer',
        'Neplatné hlasy'
    ]
}

export const humanizePrediction = (prediction, names) => {
    const result = [];
    for (let i = 0; i < prediction.votesRatio.length; i++) {
        const value = prediction.votesRatio[i];
        result.push([names[i], Math.floor(value * 10000) / 100]);
    }
    return result.sort((a, b) => b[1] - a[1]);
}
