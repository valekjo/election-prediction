const fs = require('fs');
const util = require('util');

const readFile = util.promisify(fs.readFile);

const readCsvToJsonLines = async (filename) => {
    const data = await readFile(filename, 'utf-8');
    const lines = data.split('\n').map(line => line.trim());
    const header = lines.shift().split(';');
    return lines.map(line => {
        const row = {};
        line.split(';').forEach((cell, index) => {
            row[header[index]] = parseInt(cell);
        })
        return row;
    });
};

// First round had 9 candidates
const getVotesFirstRound = (line) => [
    line.HLASY_01,
    line.HLASY_02,
    line.HLASY_03,
    line.HLASY_04,
    line.HLASY_05,
    line.HLASY_06,
    line.HLASY_07,
    line.HLASY_08,
    line.HLASY_09,
];

const transformUnit = (line, getVotes) => {
    const totalVotes = parseInt(line.VYD_OBALKY);
    const votes = getVotes(line);
    return {
        // _rawData: line,
        // Unique identifier of unit
        id: `${line.OBEC}-${line.OKRSEK}`,
        // Total number of voters
        totalVoters: parseInt(line.VOL_SEZNAM),
        // Total number of votes
        totalVotes,
        // Array of votes for candidates
        votes,
        votesRatio: votes.map(x => totalVotes === 0 ? 0 : x / totalVotes),
    };
}

// The most important function - distance of 2 units. The lower the distance, the more are the results likely to be similar
// TODO: Maybe include some size penalty?
const getDistance = (unitA, unitB) => {
    // First try mean square error of votesRatio
    // Number of items is the same in both units
    let distance = 0;
    const numItems = unitA.votesRatio.length;
    for(let i = 0; i < unitA.votesRatio.length; i++) {
        distance += (unitA.votesRatio[i] - unitB.votesRatio[i]) ** 2
    }
    return distance / numItems;
}

// Get most similar unit from reference units
const getBestMatch = (unit, referenceUnits) => {
    const unitsWithDistances = referenceUnits.map((u => ({
            unit: u, 
            distance: getDistance(unit, u)
        })))
        .sort((a, b) => a.distance - b.distance);
    return unitsWithDistances[0].unit;
}

// Project result of given unit
const projectUnitOutcome = (unit, referenceUnit) => {
    // Project total votes based on attendance in reference unit - assume the same percentage
    const totalVotes = Math.round((referenceUnit.totalVotes / referenceUnit.totalVoters) * unit.totalVoters);
    // The ratio of votes is projected to be the same as in the reference unit
    const votesRatio = referenceUnit.votesRatio.map(x => x);
    // Votes are respective portion of total votes, but rounded
    const votes = votesRatio.map(x => Math.round(x * totalVotes));

    return {
        id: unit.id,
        totalVoters: unit.totalVoters,
        totalVotes,
        votes,
        votesRatio,
    }
}

// TODO: Prepare the tests
(async() => {
    const rawData = await readCsvToJsonLines('./data/train/pet1.csv');

    const firstRoundData = rawData.map((line) => transformUnit(line, getVotesFirstRound));

    const testUnit = firstRoundData[0];
    const referenceUnits = firstRoundData.slice(100, 300);
    const referenceUnit = getBestMatch(testUnit, referenceUnits);
    const testUnitProjection = projectUnitOutcome(testUnit, referenceUnit);
    console.info({testUnit, referenceUnit, testUnitProjection});
})();