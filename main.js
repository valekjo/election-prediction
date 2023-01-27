const fs = require('fs');
const util = require('util');

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

const writeJson = async (filename, data) => {
    await writeFile(filename, JSON.stringify(data, null, 2));
}

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
        // Total number of voters
        totalVoters,
        sizeClass: Math.floor(totalVoters / 20),
        // Total number of votes
        totalVotes,
        // Array of votes for candidates
        votes,
        votesRatio: votes.map(x => totalVotes === 0 ? 0 : x / totalVotes),
    };

    return unit;
}

// The most important function - distance of 2 units. The lower the distance, the more are the results likely to be similar
// TODO: Maybe include some size penalty?
const getDistance = (unitA, unitB) => {
    // First try mean square error of votesRatio
    // Number of items is the same in both units
    let distance = 0;
    const numItems = unitA.votesRatio.length;


    for(let i = 0; i < numItems; i++) {
        distance += (unitA.votesRatio[i] * 100 - unitB.votesRatio[i] * 100) ** 2
    }

    if (unitB.id === '7105-536687-1' && unitA.id === '7105-570281-1') {
        console.log('Fitted the unit', {
            id: unitA.id,
            numItems,
            ni2: unitB.votesRatio.length,
            distance,
            votesRatioA: unitA.votesRatio,
            votesRatioB: unitB.votesRatio,
        });
    }


    return distance / numItems;
}

// Get most similar unit from reference units
const getBestMatchByDistance = (unit, referenceUnits) => {
    const unitsWithDistances = referenceUnits.map((u => ({
            unit: u, 
            distance: getDistance(unit, u)
        })))
        .sort((a, b) => a.distance - b.distance);
    const matchedUnit = unitsWithDistances[0].unit;
    return matchedUnit;
}

const getBestMatch = (unit, referenceUnits) => {
    const preferences = [
        { 
            name: 'Stejna velikost, stejna obec',
            filter: ({sizeClass, l2}) => unit.l2 === l2 && sizeClass === unit.sizeClass
        },
        {
            name: 'Stejna velikost, stejny okres',
            filter: ({sizeClass, l1}) => unit.l1 === l1 && sizeClass === unit.sizeClass
        },
        {
            name: 'Stejna obec',
            filter: ({l2}) => unit.l2 === l2,
        },
        {
            name: 'Stejny okres',
            filter: ({l1}) => unit.l1 === l1,
        },
        {
            name: 'Stejna velikost',
            filter: ({sizeClass}) => unit.sizeClass === sizeClass,
        }
    ];
    for(const preference of preferences) {
        const matchedUnits = referenceUnits.filter(preference.filter);
        if (matchedUnits.length > 0) {
            return getBestMatchByDistance(unit, matchedUnits);
        }
    }
    return getBestMatchByDistance(unit, referenceUnits);
}

// Project result of given unit
const predictUnitFromReference = (unit, referenceUnit) => {
    // Project total votes based on attendance in reference unit - assume the same percentage
    const totalVotes = (referenceUnit.totalVotes * unit.totalVoters/ referenceUnit.totalVoters);
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

const sumResults = (units) => {
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

    const partialHistoricData = historicData.filter((unit) => partialCurrentDataMap[unit.id]);
    // console.log(partialHistoricData);

    // Ids of all units
    const unitIds = Object.keys(historicDataMap);
    const predictedData = unitIds.map((unitId) => {
        // If we already have data for the unit, just take it's value as prediction (it is what it is)
        if (partialCurrentDataMap[unitId]) return partialCurrentDataMap[unitId];
        const unit = historicDataMap[unitId];
        const referenceUnit = getBestMatch(unit, partialCurrentData);
        // if (referenceUnit.id === '7105-536687-1') {
        //     console.log(unit, referenceUnit);
        // }
        return predictUnitFromReference(unit, referenceUnit); 
    });


    // void writeJson(`${new Date().toISOString()}.json`, predictedData);

    return sumResults(predictedData);
}

const printNicely = (results) => {
    const formatter = new Intl.NumberFormat('en-US', {style: 'percent', minimumFractionDigits: 2, /* minimumIntegerDigits: 2 */} );
    const percentages = results.votesRatio.map(x => formatter.format(x)).join('\t');
    console.log(percentages);
}

const printSeparator = () => console.log('-------------------------------------------------------------');

const pickItemsWithChance = (array, chance) => {
    return array.filter((_, i) => i % 20 === 0);
    // return array.filter(() => Math.random() < chance);
}

const combinePredictions = (predictions) => {
    return sumResults(predictions);
}

const predictFromDatasets = (historicDatasets, observedData) => {
    const predictions = historicDatasets.map((dataset) => predictFromDataset(dataset, observedData));


    const prediction = combinePredictions(predictions);

    console.log('Individual predictions');
    printSeparator();
    predictions.forEach(printNicely);
    printSeparator();
    printNicely(prediction);
}

// TODO: Prepare the tests
const main = async() => {
    const rawData2018 = await readCsvToJsonLines('./data/train/prez-2018.csv');
    const rawData2023 = await readCsvToJsonLines('./data/train/prez-2023.csv');

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
    const secondRound2018 = rawData2018.filter(row => row.CHYBA === 0 &&  row.KOLO === 2).map((line) => transformUnit(line, (line) => [
        line.HLASY_07,
        line.HLASY_09,
        line.VYD_OBALKY - line.PL_HL_CELK,
    ]));

    const firstRound2023 = rawData2023.filter(row => row.CHYBA === 0 && row.KOLO === 1).map((line) => transformUnit(line, (line) => [
        line.HLASY_01,
        line.HLASY_02,
        // line.HLASY_03,
        line.HLASY_04,
        line.HLASY_05,
        line.HLASY_06,
        line.HLASY_07,
        line.HLASY_08,
        line.HLASY_09,
        0,
        line.VYD_OBALKY - line.PL_HL_CELK,
    ]));

    const fullNewData = firstRound2023;

    // We take 5% of the historic data as the current data, so we can test it
    const observedData = pickItemsWithChance(fullNewData, 0.05);

    console.log(`Predicting from ${observedData.length} ( ${Math.floor(observedData.length * 100 / fullNewData.length)}%) units:`);
    predictFromDatasets([
        firstRound2018,
        // secondRound2018,
    ], observedData);


    printSeparator();
    printNicely(sumResults(fullNewData))
    console.log('Real results ↑ ↑ ↑');

};

(async () => {
    await main();
})();