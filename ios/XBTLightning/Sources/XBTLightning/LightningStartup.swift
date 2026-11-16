import Foundation

// The mobile engine is process-wide. A callback timeout does not establish
// that it stopped; keep observing its state and retain bounded background time.
func waitForLightningStartup(_ task: Task<Void, Error>, onConfirmedFailure: () async -> Void) async throws {
    do {
        try await task.value
    } catch NodeFailure.timedOut {
        throw NodeFailure.timedOut
    } catch {
        await onConfirmedFailure()
        throw error
    }
}
