import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MotionPipelineController } from '../motionPipeline.js';

/**
 * @param {{x: number, y: number, z: number}} acc
 * @returns {Object}
 */
const motionEvent = (acc) => ({ accelerationIncludingGravity: acc });

describe('MotionPipelineController', () => {
    let pipeline;

    beforeEach(() => {
        vi.useFakeTimers();
        // jsdom does not implement DeviceMotionEvent, so without this the
        // pipeline would correctly refuse to start and every test below would
        // be asserting against a controller that never ran.
        vi.stubGlobal('DeviceMotionEvent', class DeviceMotionEvent { });
        pipeline = new MotionPipelineController();
    });

    afterEach(() => {
        pipeline.stop();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('reports no-hardware when no event ever arrives', async () => {
        // Desktop browsers define DeviceMotionEvent whether or not the machine
        // has an accelerometer, so silence is the only way to tell them apart.
        // Without this the UI sat on "waiting" forever on every laptop.
        const updates = [];
        await pipeline.start((u) => updates.push(u));

        expect(pipeline.getStatus()).toBe('waiting');

        await vi.advanceTimersByTimeAsync(3100);

        expect(pipeline.getStatus()).toBe('no-hardware');
        expect(updates.at(-1).status).toBe('no-hardware');
        expect(updates.at(-1).available).toBe(false);
    });

    it('reports active once readings arrive', async () => {
        await pipeline.start(() => { });

        for (let i = 0; i < 10; i++) {
            pipeline.handleMotion(motionEvent({ x: 0, y: 0, z: 9.81 }));
        }

        expect(pipeline.getStatus()).toBe('active');
        expect(pipeline.isAvailable()).toBe(true);
    });

    it('does not flip to no-hardware after data has been seen', async () => {
        await pipeline.start(() => { });
        pipeline.handleMotion(motionEvent({ x: 0, y: 0, z: 9.81 }));

        await vi.advanceTimersByTimeAsync(3100);

        expect(pipeline.getStatus()).not.toBe('no-hardware');
    });

    it('scores a device at rest near zero', async () => {
        await pipeline.start(() => { });

        for (let i = 0; i < 12; i++) {
            pipeline.handleMotion(motionEvent({ x: 0, y: 0, z: 9.81 }));
        }

        expect(pipeline.getMotionScore()).toBeLessThan(0.05);
    });

    it('scores violent movement highly', async () => {
        await pipeline.start(() => { });

        for (let i = 0; i < 12; i++) {
            pipeline.handleMotion(motionEvent({ x: 18, y: 14, z: 20 }));
        }

        expect(pipeline.getMotionScore()).toBeGreaterThan(0.7);
    });

    it('needs a minimum number of samples before scoring', async () => {
        await pipeline.start(() => { });
        pipeline.handleMotion(motionEvent({ x: 30, y: 30, z: 30 }));
        expect(pipeline.getMotionScore()).toBe(0);
    });

    it('ignores malformed events', async () => {
        await pipeline.start(() => { });
        expect(() => pipeline.handleMotion({})).not.toThrow();
        expect(() => pipeline.handleMotion({ accelerationIncludingGravity: {} })).not.toThrow();
        expect(pipeline.getStatus()).toBe('waiting');
    });

    it('treats a stalled stream as unavailable', async () => {
        await pipeline.start(() => { });
        for (let i = 0; i < 10; i++) {
            pipeline.handleMotion(motionEvent({ x: 5, y: 5, z: 12 }));
        }
        expect(pipeline.isAvailable()).toBe(true);

        await vi.advanceTimersByTimeAsync(3000);

        expect(pipeline.getStatus()).toBe('stalled');
        expect(pipeline.getMotionScore()).toBe(0);
    });

    it('clears the probe timer on stop', async () => {
        const updates = [];
        await pipeline.start((u) => updates.push(u));
        const countAtStop = updates.length;

        pipeline.stop();
        await vi.advanceTimersByTimeAsync(5000);

        expect(updates.length).toBe(countAtStop);
    });
});
