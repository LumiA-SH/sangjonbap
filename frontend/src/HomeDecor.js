import React from 'react';
import './HomeDecor.css';

const asset = name => `/assets/decor/${name}.svg`;

export function HomeHeaderDecor() {
    return (
        <div className="home-decor-header" aria-hidden="true">
            <img className="home-decor-cutlery" src={asset('crossed-cutlery')} alt="" />
            <img className="home-decor-stamp" src={asset('recovered-stamp')} alt="" />
            <img className="home-decor-tray" src={asset('meat-tray')} alt="" />
            <img className="home-decor-splatter home-decor-splatter-left" src={asset('blood-splatter-left')} alt="" />
            <img className="home-decor-splatter home-decor-splatter-right" src={asset('blood-splatter-right')} alt="" />
        </div>
    );
}

export function HomeCardDecor({ type = 'default' }) {
    return <span className={`home-card-decor home-card-decor-${type}`} aria-hidden="true" />;
}

export function HomeBarcode() {
    return <img className="home-profile-barcode" src={asset('barcode')} alt="" aria-hidden="true" />;
}

export function HomeEmptyIcon({ type }) {
    return <img className="home-empty-icon" src={asset(type === 'activity' ? 'icon-radio' : 'icon-notice')} alt="" aria-hidden="true" />;
}
