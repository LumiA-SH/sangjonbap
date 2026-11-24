import React from 'react';
import './HomeDecor.css';
import {publicAsset} from './publicAsset';

const asset = name => publicAsset(`assets/decor/${name}.svg`);

export function PageHeader({title, description, children, className = ''}) {
    return (
        <header className={'survival-heading page-header ' + className}>
            <HomeHeaderDecor/>
            {children || <>
                <small>SURVIVOR TERMINAL</small>
                <h1>{title}</h1>
                {description && <p>{description}</p>}
            </>}
        </header>
    );
}

export function HomeHeaderDecor() {
    return (
        <div className="home-decor-header" aria-hidden="true">
            <img className="home-decor-tape" src={asset('warning-tape-print')} alt="" />
            <img className="home-decor-drip" src={publicAsset('assets/decor/피2.png')} alt="" />
            <img className="home-decor-cutlery" src={publicAsset('assets/decor/포크나이프.png')} alt="" />
            <img className="home-decor-stamp" src={asset('recovered-stamp-print')} alt="" />
            <img className="home-decor-tray" src={publicAsset('assets/decor/식판.png')} alt="" />
            <img className="home-decor-splatter home-decor-splatter-left" src={publicAsset('assets/decor/피1.png')} alt="" />
            <img className="home-decor-splatter home-decor-splatter-right" src={publicAsset('assets/decor/피3.png')} alt="" />
        </div>
    );
}

export function HomeCardDecor({type}) {
    const labels = {profile: 'classified-print', notice: 'restricted-print', event: 'exhibit-print'};
    if (!labels[type]) return null;
    return (
        <span className="home-card-print" aria-hidden="true">
            <img className="home-card-paper" src={asset('torn-paper-print')} alt="" />
            <img className="home-card-stamp" src={asset(labels[type])} alt="" />
        </span>
    );
}

export function HomeBarcode() {
    return <img className="home-profile-barcode" src={asset('barcode')} alt="" aria-hidden="true" />;
}

export function HomeEmptyIcon({ type }) {
    return <img className="home-empty-icon" src={asset(type === 'activity' ? 'icon-radio' : 'icon-notice')} alt="" aria-hidden="true" />;
}
