// src/sys/serviceRegistry.ts
// Global service registry to avoid circular dependencies

export class ServiceRegistry {
    private static instance: ServiceRegistry;
    private services: Map<string, any> = new Map();

    private constructor() {}

    public static getInstance(): ServiceRegistry {
        if (!ServiceRegistry.instance) {
            ServiceRegistry.instance = new ServiceRegistry();
        }
        return ServiceRegistry.instance;
    }

    public register(name: string, service: any): void {
        this.services.set(name, service);
    }

    public get<T>(name: string): T | null {
        return this.services.get(name) || null;
    }

    public clear(): void {
        this.services.clear();
    }
}

// Convenience functions
export function registerService(name: string, service: any): void {
    ServiceRegistry.getInstance().register(name, service);
}

export function getService<T>(name: string): T | null {
    return ServiceRegistry.getInstance().get<T>(name);
}