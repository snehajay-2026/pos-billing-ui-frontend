const DINING_RESET_BUFFER_MINUTES = 6;
const NO_SUITABLE_TABLE_BUFFER_MINUTES = 25;

const getTableTurnoverMinutes = (table) => {
  if (!table || table.status !== "booked") return 0;

  const partySize = Number(table.partySize || 1);
  const baseMinutes = 42 + Math.max(0, partySize - 2) * 9;
  const now = new Date();

  if (table.checkInDate || table.checkInTime) {
    try {
      const checkInDate = table.checkInDate
        ? new Date(`${table.checkInDate}T${table.checkInTime || "00:00"}`)
        : null;
      if (checkInDate && !Number.isNaN(checkInDate.getTime())) {
        const elapsedMinutes = Math.max(
          0,
          Math.round((now.getTime() - checkInDate.getTime()) / 60000)
        );
        return Math.max(0, baseMinutes - elapsedMinutes) + DINING_RESET_BUFFER_MINUTES;
      }
    } catch (error) {
      // ignore invalid dates and fall back to base estimate
    }
  }

  return baseMinutes + DINING_RESET_BUFFER_MINUTES;
};

export const getEstimatedWaitMinutes = ({ queueIndex = 0, seats = 1, tables = [] }) => {
  const requestedSeats = Math.max(1, Number(seats || 1));
  const normalizedTables = (tables || [])
    .map((table) => ({
      id: table?.id,
      seats: Number(table?.seats || 0),
      availableAt: table?.status === "booked" ? getTableTurnoverMinutes(table) : 0,
    }))
    .filter((table) => table.seats > 0)
    .sort((left, right) => left.availableAt - right.availableAt || left.seats - right.seats);

  const suitableTables = normalizedTables.filter((table) => table.seats >= requestedSeats);
  if (!suitableTables.length) {
    return NO_SUITABLE_TABLE_BUFFER_MINUTES + Math.max(0, Number(queueIndex || 0)) * 12;
  }

  const tablePool = suitableTables.map((table) => ({ ...table }));
  const seatPenalty = (tableSeats) => Math.max(0, tableSeats - requestedSeats) * 2;
  let estimate = 0;

  for (let position = 0; position <= Math.max(0, Number(queueIndex || 0)); position += 1) {
    tablePool.sort((left, right) => {
      const leftScore = left.availableAt + seatPenalty(left.seats);
      const rightScore = right.availableAt + seatPenalty(right.seats);
      return leftScore - rightScore || left.seats - right.seats;
    });

    const chosenTable = tablePool[0];
    const partyPrepBuffer = Math.max(0, requestedSeats - 2) * 2;
    const arrivalBuffer =
      (position === 0 && chosenTable.availableAt === 0 ? 5 : 8) + partyPrepBuffer;
    estimate = chosenTable.availableAt + arrivalBuffer + seatPenalty(chosenTable.seats);
    chosenTable.availableAt =
      estimate + 38 + Math.max(0, requestedSeats - 2) * 7 + DINING_RESET_BUFFER_MINUTES;
  }

  return Math.max(5, Math.round(estimate));
};

export const formatWaitTime = (minutes = 0) => {
  if (minutes <= 0) return "Now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours} hr` : `${hours} hr ${remainder} min`;
};
